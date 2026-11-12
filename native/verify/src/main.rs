//! Compares the docs of two rustdoc JSON outputs of the same crate, one built from the sources
//! before the `comments` tool rewrapped them and one after.
//!
//! For every item, the docs must render the same. That means the same Markdown events from
//! pulldown-cmark with the options rustdoc uses, where a line break inside a paragraph
//! counts as a space and runs of whitespace in text count as one space, since HTML renders
//! them alike. The intra-doc links that rustdoc resolved must be the same too, and so must
//! the doc text once runs of whitespace count as one space.
//!
//! A link must also stay on one line. rust-analyzer only resolves a link that sits on one line
//! of a doc comment, so a link that continues on the next line can't be followed in an editor.
//! A link that was on one line before the rewrap may never continue on the next line after it.
//! With `--links-on-one-line`, no link may continue on the next line after the rewrap at all,
//! which holds for docs whose links all fit on a line.
//!
//! Usage: `comments-verify <before.json> <after.json> [--links-on-one-line]`

use pulldown_cmark::{BrokenLink, CodeBlockKind, CowStr, Event, Options, Parser, Tag, TagEnd};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::ExitCode;

fn collapse(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The options that rustdoc renders docs with, in `main_body_opts`.
fn options() -> Options {
  Options::ENABLE_TABLES
    | Options::ENABLE_FOOTNOTES
    | Options::ENABLE_STRIKETHROUGH
    | Options::ENABLE_TASKLISTS
    | Options::ENABLE_SMART_PUNCTUATION
}

fn describe_tag(tag: &Tag) -> String {
  match tag {
    Tag::Link {
      link_type,
      dest_url,
      title,
      id,
    }
    | Tag::Image {
      link_type,
      dest_url,
      title,
      id,
    } => {
      let kind = if matches!(tag, Tag::Link { .. }) {
        "Link"
      } else {
        "Image"
      };

      format!(
        "{kind} {link_type:?} dest={:?} title={:?} id={:?}",
        collapse(dest_url),
        collapse(title),
        collapse(id)
      )
    }
    // the strings of a tag are compared by their text, never by how pulldown-cmark stores them
    Tag::Heading {
      level,
      id,
      classes,
      attrs,
    } => {
      let id = id.as_deref();
      let classes: Vec<&str> = classes.iter().map(|class| class.as_ref()).collect();
      let attrs: Vec<(&str, Option<&str>)> = attrs
        .iter()
        .map(|(key, value)| (key.as_ref(), value.as_deref()))
        .collect();

      format!("Heading {level:?} id={id:?} classes={classes:?} attrs={attrs:?}")
    }
    Tag::CodeBlock(CodeBlockKind::Fenced(info)) => {
      format!("CodeBlock fenced {:?}", info.as_ref())
    }
    Tag::CodeBlock(CodeBlockKind::Indented) => "CodeBlock indented".to_string(),
    Tag::FootnoteDefinition(label) => format!("FootnoteDefinition {:?}", label.as_ref()),
    other => format!("{other:?}"),
  }
}

/// Describes the rendered structure of Markdown, with whitespace in text normalized.
fn events(markdown: &str) -> Vec<String> {
  // like rustdoc, a link without a definition resolves its text, with each run of whitespace as one space
  let mut resolve = |link: BrokenLink<'_>| Some((CowStr::from(collapse(&link.reference)), CowStr::from("")));

  let mut out = Vec::new();
  let mut text = String::new();
  let mut code_blocks = 0usize;

  let flush = |text: &mut String, out: &mut Vec<String>| {
    if !text.is_empty() {
      let collapsed: String = {
        let mut result = String::new();
        let mut space = false;

        for c in text.chars() {
          if c.is_whitespace() {
            space = true;
          } else {
            if space {
              result.push(' ');
              space = false;
            }

            result.push(c);
          }
        }

        if space {
          result.push(' ');
        }

        result
      };

      out.push(format!("Text {collapsed:?}"));
      text.clear();
    }
  };

  for event in Parser::new_with_broken_link_callback(markdown, options(), Some(&mut resolve)) {
    match event {
      Event::Text(value) if code_blocks == 0 => text.push_str(&value),
      Event::SoftBreak => text.push(' '),
      other => {
        flush(&mut text, &mut out);

        let described = match &other {
          Event::Start(tag) => {
            if matches!(tag, Tag::CodeBlock(_)) {
              code_blocks += 1;
            }

            format!("Start {}", describe_tag(tag))
          }
          Event::End(tag) => {
            if matches!(tag, TagEnd::CodeBlock) {
              code_blocks -= 1;
            }

            format!("End {tag:?}")
          }
          Event::Html(html) | Event::InlineHtml(html) => {
            format!("Html {:?}", collapse(html))
          }
          // a code block keeps its text exactly
          Event::Text(value) => format!("CodeText {:?}", value.as_ref()),
          Event::Code(value) => format!("Code {:?}", value.as_ref()),
          Event::InlineMath(value) => format!("InlineMath {:?}", value.as_ref()),
          Event::DisplayMath(value) => format!("DisplayMath {:?}", value.as_ref()),
          Event::FootnoteReference(label) => {
            format!("FootnoteReference {:?}", label.as_ref())
          }
          other => format!("{other:?}"),
        };

        out.push(described);
      }
    }
  }

  flush(&mut text, &mut out);

  out
}

/// Returns an entry for each link and image of the Markdown, in their order. The entry of one
/// that continues on another line holds its source text. pulldown-cmark finds them like it does
/// for rust-analyzer, with a callback that takes every `[text]` without a definition as a link.
fn links_across_lines(markdown: &str) -> Vec<Option<&str>> {
  let mut resolve = |link: BrokenLink<'_>| Some((CowStr::from(collapse(&link.reference)), CowStr::from("")));

  Parser::new_with_broken_link_callback(markdown, options(), Some(&mut resolve))
    .into_offset_iter()
    .filter_map(|(event, range)| match event {
      Event::Start(Tag::Link { .. } | Tag::Image { .. }) => {
        let text = &markdown[range];

        Some(text.contains('\n').then_some(text))
      }
      _ => None,
    })
    .collect()
}

struct Item {
  docs: Option<String>,
  links: BTreeMap<String, String>,
}

fn read_items(path: &str) -> Result<BTreeMap<String, Item>, String> {
  let text = std::fs::read_to_string(path).map_err(|error| format!("{path}: {error}"))?;
  let json: Value = serde_json::from_str(&text).map_err(|error| format!("{path}: {error}"))?;
  let index = json["index"].as_object().ok_or_else(|| format!("{path}: no index"))?;
  let mut items = BTreeMap::new();

  // the code is the same before and after, so each item has the same id in both outputs
  for (id, item) in index {
    let name = format!("{} (id {id})", item["name"].as_str().unwrap_or("<unnamed>"));

    let links = item["links"]
      .as_object()
      .map(|links| {
        links
          .iter()
          .map(|(key, value)| (key.clone(), value.to_string()))
          .collect()
      })
      .unwrap_or_default();

    items.insert(
      name.to_string(),
      Item {
        docs: item["docs"].as_str().map(str::to_string),
        links,
      },
    );
  }

  Ok(items)
}

const LINKS_ON_ONE_LINE: &str = "--links-on-one-line";

fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let links_on_one_line = args.iter().any(|arg| arg == LINKS_ON_ONE_LINE);
  let paths: Vec<&String> = args.iter().filter(|arg| *arg != LINKS_ON_ONE_LINE).collect();

  if paths.len() != 2 || paths.iter().any(|path| path.starts_with("--")) {
    eprintln!("usage: comments-verify <before.json> <after.json> [{LINKS_ON_ONE_LINE}]");
    return ExitCode::from(2);
  }

  let (before, after) = match (read_items(paths[0]), read_items(paths[1])) {
    (Ok(before), Ok(after)) => (before, after),
    (Err(error), _) | (_, Err(error)) => {
      eprintln!("{error}");
      return ExitCode::from(2);
    }
  };

  let mut failures = 0usize;
  let mut changed = 0usize;
  let mut links = 0usize;
  let mut split_before = 0usize;
  let mut split_after = 0usize;

  if before.len() != after.len() || !before.keys().eq(after.keys()) {
    eprintln!(
      "the crates have different items: {} before, {} after",
      before.len(),
      after.len()
    );
    return ExitCode::FAILURE;
  }

  for (name, old) in &before {
    let new = &after[name];
    let old_docs = old.docs.as_deref().unwrap_or("");
    let new_docs = new.docs.as_deref().unwrap_or("");

    links += old.links.len();

    if old_docs != new_docs {
      changed += 1;
    }

    let mut problems = Vec::new();

    if collapse(old_docs) != collapse(new_docs) {
      problems.push("the text differs in more than whitespace".to_string());
    }

    if old.links != new.links {
      problems.push(format!("the resolved links differ: {:?} vs {:?}", old.links, new.links));
    }

    let (old_events, new_events) = (events(old_docs), events(new_docs));

    if old_events != new_events {
      let at = old_events
        .iter()
        .zip(&new_events)
        .position(|(a, b)| a != b)
        .unwrap_or(old_events.len().min(new_events.len()));

      problems.push(format!(
        "the rendered Markdown differs at event {at}: {:?} vs {:?}",
        old_events.get(at),
        new_events.get(at)
      ));
    }

    let (old_links, new_links) = (links_across_lines(old_docs), links_across_lines(new_docs));

    split_before += old_links.iter().flatten().count();
    split_after += new_links.iter().flatten().count();

    // docs that render the same hold the same links in the same order
    for (index, link) in new_links.iter().enumerate() {
      let Some(link) = link else {
        continue;
      };

      if old_links.get(index).is_some_and(Option::is_none) {
        problems.push(format!(
          "a link that was on one line continues on the next line: {link:?}"
        ));
      } else if links_on_one_line {
        problems.push(format!("a link continues on the next line: {link:?}"));
      }
    }

    if !problems.is_empty() {
      failures += 1;

      if failures <= 20 {
        eprintln!(
          "{name}:\n  {}\n--- before\n{old_docs}\n--- after\n{new_docs}\n",
          problems.join("\n  ")
        );
      }
    }
  }

  println!(
    "{} items compared, {changed} with rewrapped docs, {links} resolved intra-doc links, {split_before} links on more than one line before and {split_after} after, {failures} that render differently or split a link",
    before.len()
  );

  if failures == 0 {
    ExitCode::SUCCESS
  } else {
    ExitCode::FAILURE
  }
}
