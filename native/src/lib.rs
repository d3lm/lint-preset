//! Lexes Rust sources for the `comments` CLI.
//!
//! Offsets cross into JavaScript, so they count UTF-16 code units rather than bytes.

use napi_derive::napi;
use ra_ap_rustc_lexer::{DocStyle, FrontmatterAllowed, LiteralKind, TokenKind, strip_shebang, tokenize};
use ra_ap_syntax::{
  Edition, SourceFile,
  ast::{self, HasGenericArgs, HasModuleItem},
};

#[napi(object)]
pub struct RustComment {
  /// Holds the UTF-16 offset of the first character of the comment, like the `/` of `///`.
  pub start: u32,
  /// Holds the UTF-16 offset after the last character of the comment.
  /// A line comment ends before its line break.
  pub end: u32,
  pub block: bool,
  /// Holds `outer` for `///` and `/**`, `inner` for `//!` and `/*!`, and nothing
  /// for other comments.
  pub doc: Option<String>,
}

#[napi(object)]
pub struct RustLexError {
  pub message: String,
  pub offset: u32,
}

#[napi(object)]
pub struct RustScan {
  pub comments: Vec<RustComment>,
  /// Describes the first token that never ends, like an unterminated block comment or string.
  /// Every comment after it is read as part of that token.
  pub error: Option<RustLexError>,
}

struct Lexed<'a> {
  kind: TokenKind,
  text: &'a str,
  utf16_start: u32,
  utf16_end: u32,
}

fn utf16_len(text: &str) -> u32 {
  text.chars().map(|c| c.len_utf16() as u32).sum()
}

/// Lexes a whole file like rustc does, with a shebang and frontmatter.
fn lex(source: &str) -> Vec<Lexed<'_>> {
  let mut tokens = Vec::new();
  let mut offset = 0usize;
  let mut utf16 = 0u32;

  if let Some(length) = strip_shebang(source) {
    let text = &source[..length];
    let end = utf16_len(text);

    tokens.push(Lexed {
      kind: TokenKind::Unknown,
      text,
      utf16_start: 0,
      utf16_end: end,
    });
    offset = length;
    utf16 = end;
  }

  for token in tokenize(&source[offset..], FrontmatterAllowed::Yes) {
    let text = &source[offset..offset + token.len as usize];
    let end = utf16 + utf16_len(text);

    tokens.push(Lexed {
      kind: token.kind,
      text,
      utf16_start: utf16,
      utf16_end: end,
    });
    offset += token.len as usize;
    utf16 = end;
  }

  tokens
}

fn doc_name(style: Option<DocStyle>) -> Option<String> {
  style.map(|style| match style {
    DocStyle::Outer => "outer".to_string(),
    DocStyle::Inner => "inner".to_string(),
  })
}

fn lex_error(kind: TokenKind) -> Option<&'static str> {
  match kind {
    TokenKind::BlockComment { terminated: false, .. } => Some("unterminated block comment"),
    TokenKind::Literal { kind, .. } => match kind {
      LiteralKind::Char { terminated: false } => Some("unterminated character literal"),
      LiteralKind::Byte { terminated: false } => Some("unterminated byte constant"),
      LiteralKind::Str { terminated: false } => Some("unterminated double quote string"),
      LiteralKind::ByteStr { terminated: false } => Some("unterminated double quote byte string"),
      LiteralKind::CStr { terminated: false } => Some("unterminated C string"),
      LiteralKind::RawStr { n_hashes: None }
      | LiteralKind::RawByteStr { n_hashes: None }
      | LiteralKind::RawCStr { n_hashes: None } => Some("invalid or unterminated raw string"),
      _ => None,
    },
    _ => None,
  }
}

#[napi]
pub fn scan_rust(source: String) -> RustScan {
  let mut comments = Vec::new();
  let mut error = None;

  for token in lex(&source) {
    if error.is_none()
      && let Some(message) = lex_error(token.kind)
    {
      error = Some(RustLexError {
        message: message.to_string(),
        offset: token.utf16_start,
      });
    }

    let (block, doc) = match token.kind {
      TokenKind::LineComment { doc_style } => (false, doc_style),
      TokenKind::BlockComment { doc_style, .. } => (true, doc_style),
      _ => continue,
    };

    comments.push(RustComment {
      start: token.utf16_start,
      end: token.utf16_end,
      block,
      doc: doc_name(doc),
    });
  }

  RustScan { comments, error }
}

/// Returns the tokens of the source without whitespace and comments, used to verify that only
/// comments changed. A run of doc comments of one style stays as one marker, since doc comments
/// are attributes of the item after them. Rewording or rewrapping one keeps the marker, while
/// turning it into another style or into a plain comment changes it.
#[napi]
pub fn rust_fingerprint(source: String) -> String {
  let mut parts: Vec<String> = Vec::new();
  let mut last_doc: Option<String> = None;

  for token in lex(&source) {
    let doc = match token.kind {
      TokenKind::Whitespace | TokenKind::LineComment { doc_style: None } => continue,
      TokenKind::BlockComment {
        doc_style: None,
        terminated: true,
      } => continue,
      TokenKind::LineComment { doc_style: Some(style) } => Some(format!("line {style:?}")),
      TokenKind::BlockComment {
        doc_style: Some(style),
        terminated: true,
      } => Some(format!("block {style:?}")),
      _ => None,
    };

    match doc {
      Some(marker) => {
        if last_doc.as_ref() != Some(&marker) {
          parts.push(format!("doc {marker}"));
          last_doc = Some(marker);
        }
      }
      None => {
        parts.push(format!("{:?} {}", token.kind, token.text));
        last_doc = None;
      }
    }
  }

  parts.join("\n")
}

fn parse(source: &str) -> Option<SourceFile> {
  let parse = SourceFile::parse(source, Edition::CURRENT);

  if parse.errors().is_empty() {
    Some(parse.tree())
  } else {
    None
  }
}

fn single_item(file: &SourceFile) -> Option<ast::Item> {
  let mut items = file.items();
  let item = items.next()?;

  if items.next().is_some() { None } else { Some(item) }
}

fn is_word(path: &ast::Path) -> bool {
  path.qualifier().is_none()
    && path
      .segment()
      .is_some_and(|segment| segment.generic_arg_list().is_none() && segment.name_ref().is_some())
}

/// Whether an expression is something prose also parses as, like a single word (`Done`)
/// or a literal.
fn is_prose_like(expr: &ast::Expr) -> bool {
  match expr {
    ast::Expr::PathExpr(path) => path.path().is_some_and(|path| is_word(&path)),
    ast::Expr::Literal(_) => true,
    ast::Expr::ParenExpr(paren) => paren.expr().is_some_and(|inner| is_prose_like(&inner)),
    _ => false,
  }
}

fn parses_as_statements(text: &str) -> bool {
  let Some(file) = parse(&format!("fn __comment() {{\n{text}\n}}")) else {
    return false;
  };

  // a `}` in the text that closes the function leaves items after it, which only code does
  let Some(ast::Item::Fn(function)) = single_item(&file) else {
    return true;
  };

  let Some(list) = function.body().and_then(|body| body.stmt_list()) else {
    return false;
  };

  let mut statements = 0;
  let mut prose_like = 0;

  for statement in list.statements() {
    statements += 1;

    if let ast::Stmt::ExprStmt(statement) = statement
      && statement.expr().is_some_and(|expr| is_prose_like(&expr))
    {
      prose_like += 1;
    }
  }

  if let Some(tail) = list.tail_expr() {
    statements += 1;

    if is_prose_like(&tail) {
      prose_like += 1;
    }
  }

  statements > 0 && prose_like < statements
}

fn is_word_expr(expr: &ast::Expr) -> bool {
  match expr {
    ast::Expr::PathExpr(path) => path.path().is_some_and(|path| is_word(&path)),
    _ => false,
  }
}

fn is_word_type(ty: &ast::Type) -> bool {
  match ty {
    ast::Type::PathType(path) => path.path().is_some_and(|path| is_word(&path)),
    _ => false,
  }
}

/// A lone field whose type or value is a word, like `Default: refuse`, reads as a label in prose
/// rather than as commented-out fields.
fn parses_as_fields(text: &str) -> bool {
  let trailing_comma = text.trim_end().ends_with(',');

  if let Some(file) = parse(&format!("struct __Comment {{\n{text}\n}}"))
    && let Some(ast::Item::Struct(item)) = single_item(&file)
    && let Some(ast::FieldList::RecordFieldList(list)) = item.field_list()
  {
    let fields: Vec<_> = list.fields().collect();

    if !fields.is_empty()
      && (fields.len() > 1
        || trailing_comma
        || fields
          .iter()
          .any(|field| !field.ty().is_some_and(|ty| is_word_type(&ty))))
    {
      return true;
    }
  }

  let Some(file) = parse(&format!("fn __comment() {{ __Comment {{\n{text}\n}} }}")) else {
    return false;
  };

  let Some(ast::Item::Fn(function)) = single_item(&file) else {
    return false;
  };

  let Some(ast::Expr::RecordExpr(record)) = function
    .body()
    .and_then(|body| body.stmt_list())
    .and_then(|list| list.tail_expr())
  else {
    return false;
  };

  let Some(list) = record.record_expr_field_list() else {
    return false;
  };

  let fields: Vec<_> = list.fields().collect();

  if fields.is_empty() || fields.iter().any(|field| field.colon_token().is_none()) {
    return false;
  }

  fields.len() > 1
    || trailing_comma
    || fields
      .iter()
      .any(|field| !field.expr().is_some_and(|expr| is_word_expr(&expr)))
}

fn parses_as_match_arms(text: &str) -> bool {
  let Some(file) = parse(&format!("fn __comment() {{ match __value {{\n{text}\n}} }}")) else {
    return false;
  };

  let Some(ast::Item::Fn(function)) = single_item(&file) else {
    return false;
  };

  let Some(ast::Expr::MatchExpr(expr)) = function
    .body()
    .and_then(|body| body.stmt_list())
    .and_then(|list| list.tail_expr())
  else {
    return false;
  };

  expr.match_arm_list().is_some_and(|list| list.arms().next().is_some())
}

/// Associated items, like a method that takes `&self` or a trait method without a body, only parse
/// in an `impl` or a trait.
fn parses_as_associated_items(text: &str) -> bool {
  ["impl __Comment", "trait __Comment"].iter().any(|head| {
    let Some(file) = parse(&format!("{head} {{\n{text}\n}}")) else {
      return false;
    };

    let list = match single_item(&file) {
      Some(ast::Item::Impl(item)) => item.assoc_item_list(),
      Some(ast::Item::Trait(item)) => item.assoc_item_list(),
      _ => None,
    };

    list.is_some_and(|list| list.assoc_items().next().is_some())
  })
}

/// Whether the text parses as Rust code. Prose almost never does, since two words in a row are
/// a syntax error.
#[napi]
pub fn is_rust_code(text: String) -> bool {
  if !text.contains(['(', ')', '[', ']', '{', '}', '=', ';', '<', '>', ':']) {
    return false;
  }

  parses_as_statements(&text)
    || parses_as_fields(&text)
    || parses_as_match_arms(&text)
    || parses_as_associated_items(&text)
}
