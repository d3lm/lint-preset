import { parseSync, type OxcError, type Statement } from 'oxc-parser';
import {
  CODE_SPAN,
  findStyleIssues,
  isBanner,
  LIST_MARKER,
  replaceKeepingLines,
  stripNonProse,
  type StyleIssueType,
} from './style.js';
import {
  bindLineStarts,
  breakAfterSentence,
  findLineIssues,
  hasWidow,
  layoutTokens,
  parentheticalAround,
  startsBlock,
  tokenize,
  type LayoutOptions,
  type LineIssue,
  type LineIssueType,
  type WrapOptions,
} from './wrap.js';

export type CommentKind = 'jsdoc' | 'block';

export type ParagraphKind = 'prose' | 'list' | 'tag' | 'code' | 'other';

export interface AnalyzeOptions extends WrapOptions {
  /**
   * Sets the preferred line length, including indentation and the comment prefix.
   */
  readonly width: number;

  /**
   * Sets the hard limit for measured prose. Parentheticals may exceed `width` up to this limit.
   * When omitted, the existing width and tolerance behavior is retained.
   */
  readonly maxWidth?: number;

  /**
   * Sets the maximum length of the line that holds a comment whose whole text is one
   * prose paragraph. Such a comment stays on one line up to this length plus `tolerance`,
   * even past `width`, but never past `maxWidth`. It defaults to `width`.
   */
  readonly singleLineWidth?: number;

  readonly tabWidth: number;

  /**
   * Whether to report prose style issues like semicolons, em-dashes, and section banners.
   */
  readonly style: boolean;
}

export type IssueType = LineIssueType | StyleIssueType;

export type IssueTier = 'verdict' | 'hint';

const ISSUE_TIERS: Record<IssueType, IssueTier> = {
  overflow: 'verdict',
  underfill: 'verdict',
  widow: 'verdict',
  unbalanced: 'verdict',
  orphan: 'hint',
  'split-parenthetical': 'hint',
  banner: 'hint',
  'em-dash': 'hint',
  semicolon: 'hint',
  'label-colon': 'hint',
  emphasis: 'hint',
  dash: 'hint',
};

export interface IssueReport {
  readonly type: IssueType;
  readonly tier: IssueTier;
  readonly line: number;
  readonly length: number;
}

export interface ParagraphReport {
  readonly kind: ParagraphKind;
  readonly startLine: number;
  readonly endLine: number;

  /**
   * Whether the paragraph is prose that can be rewrapped. When `false`, `reason` says why.
   */
  readonly reflowable: boolean;
  readonly reason?: string;
  readonly issues: readonly IssueReport[];

  /**
   * Holds the exact source lines for `startLine` through `endLine` when the paragraph is
   * greedily wrapped to the width, or `null` when the paragraph isn't prose, e.g. code,
   * a table, a diagram, or `@example`. A paragraph that is accepted with the layout for a
   * wider width within the tolerance keeps its lines.
   */
  readonly suggestion: readonly string[] | null;
}

export interface CommentReport {
  readonly file: string;
  readonly kind: CommentKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly indent: string;
  readonly width: number;
  readonly maxWidth?: number;

  /**
   * Holds the length of each source line from `startLine` through `endLine`, with tabs expanded.
   */
  readonly lengths: readonly number[];
  readonly text: string;
  readonly paragraphs: readonly ParagraphReport[];
}

export interface SyntaxFailure {
  readonly message: string;

  /**
   * Holds the 1-based line of the error, when the parser names one.
   */
  readonly line?: number;
}

export interface SourceAnalysis {
  readonly comments: CommentReport[];

  /**
   * Describes the syntax error that the parser stopped at. The parser never sees the comments after
   * one, so such a source has no comments at all instead of only those before the error.
   */
  readonly syntaxError?: SyntaxFailure;
}

interface BodyLine {
  /**
   * Holds the 0-based index of the line in the file.
   */
  readonly index: number;
  readonly prefix: string;
  readonly text: string;
  readonly verbatim: boolean;

  /**
   * Whether the source line ends with Markdown hard line break syntax, which `text` no longer
   * holds after trimming.
   */
  readonly hardBreak: boolean;
}

interface RawParagraph {
  kind: ParagraphKind;
  lines: BodyLine[];
  marker: string;
  reason?: string;
}

interface ParsedComment {
  readonly type: 'Line' | 'Block';
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const IGNORE_DIRECTIVE = 'comments-ignore';

const FENCE = /^(?:`{3,}(?!.*`)|~{3,})/;
const JSDOC_TAG = /^@([A-Za-z]+)/;
const NESTED_LIST_MARKER = /^\s+(?:[-*+]|\d+[.)])\s+/;

/**
 * Tags whose content is a prose description, while others like `@example` hold code and
 * are never rewrapped.
 */
const PROSE_TAGS = new Set([
  'arg',
  'argument',
  'deprecated',
  'description',
  'exception',
  'note',
  'param',
  'prop',
  'property',
  'remarks',
  'return',
  'returns',
  'see',
  'since',
  'summary',
  'template',
  'throws',
  'todo',
  'typeParam',
  'yields',
]);

// tags whose content is code that runs until the next tag, empty lines included, like a multi-part `@example`
const CODE_TAGS = new Set(['default', 'defaultValue', 'example']);

// tags followed by a name, as in `@param {Type} name - description`
const NAMED_TAGS = new Set(['arg', 'argument', 'param', 'prop', 'property', 'template', 'typeParam']);

/**
 * Tool directives take effect in any comment line, so a JSDoc line that starts with one is kept
 * as it is. Each is the exact name of a directive, since prose can start a line with a package
 * name like `eslint-config-prettier`.
 */
const LINE_DIRECTIVE =
  /^\s*(?:(?:eslint|oxlint|stylelint)-(?:disable(?:-next-line|-line)?|enable)\b|eslint-env\b|@ts-(?:ignore|expect-error|nocheck|check)\b|@jsx\w*\b|@vite-ignore\b|[@#]__[A-Z_]+__|@(?:vitest|jest)-environment\b|(?:istanbul|c8|v8)\s+ignore\b|prettier-ignore\b|biome-ignore\b|deno-(?:lint-ignore|fmt-ignore)(?:-file)?\b|tslint:|(?:c[sS]pell|spell-?checker)\s*:|(?:webpack|turbopack)[A-Z][a-zA-Z]*\s*:|vim?:\s|#(?:region|endregion)\b|<reference\s)/;

/**
 * These directives are only read from a whole block comment, like `/* global foo *\/`
 * or `/* eslint quotes: 1 *\/`. Their markers are ordinary words, so they never count
 * as directives on a single line of a longer comment.
 */
const BLOCK_DIRECTIVE = /^\s*(?:eslint\s|globals?\s|exported\s|jshint\s|jslint\s|type\s*:)/;

/**
 * Legal comments are kept as they are. A comment is legal when it uses the same markers
 * as bundlers like esbuild (`/*!`, `//!`, `@license`, and `@preserve`), or when it is a
 * copyright notice like `Copyright (c) 2020 Foo`.
 */
const LEGAL_COMMENT = /^!|@license\b|@preserve\b|\bcopyright\s+(?:\(c\)|©|\d{4})/i;

// a term of one or two words or a code span (stripped to two backticks), then a dash or colon and its definition
const DEFINITION = /^(?:``|[\w$.[\]]+(?:[ -][\w$.[\]]+)?)(?: [-–]|:) \S/;

const BOX_DRAWING = /[\u2500-\u257F]/;

// a Markdown table delimiter row like `--- | ---` or `|:--|--:|`, which needs no leading pipe
const TABLE_DELIMITER = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?$/;

const ARROWS_OR_RULES = /[▲▼◀▶→←↑↓]|-->|<--|\+-{2,}|-{3,}|={4,}/;

// two or more spaces after text, or a backslash that another backslash doesn't escape
const HARD_BREAK = /\S {2,}$|(?<!\\)\\(?:\\\\)*$/;

/**
 * Describes how a paragraph that the tool keeps as written is checked.
 *
 * - `code`: code that the parser accepts, which gets no checks besides banners
 * - `code-like`: a paragraph with a line that may be code, like one that ends with `{`, which gets
 *   no style hints, since they would point at the code, but must still fit the width
 * - `layout`: documented layout syntax like a table row, which gets style hints but no verdicts
 * - `manual`: text that is or may be laid out by hand or may be markup, like a Markdown hard line
 *   break, arrows, or a heading, which gets style hints and must still fit the width.
 */
type StructureTier = 'code' | 'code-like' | 'layout' | 'manual';

interface Structure {
  readonly tier: StructureTier;
  readonly reason: string;
}

/**
 * Whether a statement is something prose also parses as, like a single word (`Done`),
 * a code span, a word before a code span (`Returns \`null\``, a tagged template), or a
 * label (`Default: refuse`). A label that ends with a semicolon, like the commented-out
 * CSS declaration `display: none;`, is code.
 */
function isProseLike(statement: Statement, source: string): boolean {
  if (statement.type === 'LabeledStatement') {
    return source[statement.end - 1] !== ';';
  }

  if (statement.type === 'EmptyStatement') {
    return true;
  }

  if (statement.type !== 'ExpressionStatement') {
    return false;
  }

  let { expression } = statement;

  while (expression.type === 'ParenthesizedExpression') {
    expression = expression.expression;
  }

  if (expression.type === 'TaggedTemplateExpression') {
    return expression.tag.type === 'Identifier';
  }

  return expression.type === 'Identifier' || expression.type === 'Literal' || expression.type === 'TemplateLiteral';
}

function parsesAsStatements(text: string): boolean {
  if (!/[()[\]{}=;<>]/.test(text)) {
    return false;
  }

  // a generator body accepts `return`, `await`, and `yield`, which are common in commented-out code
  const source = `async function* comment() {\n${text}\n}`;
  const { program, errors } = parseSync('comment.tsx', source);
  const wrapper = program.body.at(0);

  if (errors.length > 0 || wrapper?.type !== 'FunctionDeclaration' || !wrapper.body) {
    return false;
  }

  const statements = wrapper.body.body;

  return statements.length > 0 && !statements.every((statement) => isProseLike(statement, source));
}

const CODE_VALUES = new Set([
  'Literal',
  'ArrayExpression',
  'ObjectExpression',
  'CallExpression',
  'NewExpression',
  'ArrowFunctionExpression',
  'FunctionExpression',
  'UnaryExpression',
  'MemberExpression',
]);

/**
 * A lone property whose value is a word or code span, like `Default: refuse`, reads as a label in
 * prose rather than as commented-out options.
 */
function parsesAsProperties(text: string): boolean {
  if (!text.includes(':')) {
    return false;
  }

  const { program, errors } = parseSync('comment.ts', `({\n${text}\n})`);
  const statement = program.body.at(0);

  if (errors.length > 0 || program.body.length !== 1 || statement?.type !== 'ExpressionStatement') {
    return false;
  }

  let { expression } = statement;

  while (expression.type === 'ParenthesizedExpression') {
    expression = expression.expression;
  }

  if (expression.type !== 'ObjectExpression' || expression.properties.length === 0) {
    return false;
  }

  const { properties } = expression;

  if (!properties.every((property) => property.type === 'Property' && !property.shorthand && !property.method)) {
    return false;
  }

  return (
    properties.length > 1 ||
    text.trimEnd().endsWith(',') ||
    properties.some((property) => property.type === 'Property' && CODE_VALUES.has(property.value.type))
  );
}

/**
 * Prose almost never parses as JavaScript, since two words in a row are a syntax error.
 */
function isCode(texts: readonly string[]): boolean {
  const text = texts.map((line) => line.replace(LIST_MARKER, '')).join('\n');

  return parsesAsStatements(text) || parsesAsProperties(text);
}

/**
 * A prose clause can end with a semicolon too, which is a style issue.
 * So `;` only ends code with code around it.
 */
function isCodeLine(text: string): boolean {
  return (
    text.endsWith('{') ||
    (text.endsWith(';') && (/[()[\]{}=<>]/.test(text) || !/\s/.test(text))) ||
    /^[}\])]/.test(text) ||
    /^(?:const|let|var)\s+[\w$]+\s*[:=]/.test(text) ||
    /^(?:import|export)\s.*(?:\sfrom\s|[{}])/.test(text)
  );
}

function layoutReason(prose: string, raw: string): string | undefined {
  if (prose.startsWith('|') || TABLE_DELIMITER.test(prose)) {
    return 'table row';
  }

  if (BOX_DRAWING.test(prose)) {
    return 'box drawing';
  }

  // a rule or border, like the `***` lines of a box, would be joined into the prose around it
  if (isBanner(raw)) {
    return 'repeated characters';
  }

  return undefined;
}

/**
 * Headings, link definitions, HTML, and quotes are markup, since joining them with the next line
 * would turn them into prose. Prose can start a line like that too, like `<T> is the type` or
 * `# of retries`, so markup is only kept as written and still has to fit the width.
 */
function isMarkup(prose: string): boolean {
  return /^#{1,6}\s/.test(prose) || /^\[[^\]]+\]:/.test(prose) || /^<\/?[a-z]/i.test(prose) || /^>(?:\s|$)/.test(prose);
}

function mask(text: string): string {
  return text.replaceAll(/[^\n]/g, 'x');
}

function maskCode(text: string): string {
  let masked = text.replaceAll(CODE_SPAN, mask);

  for (let previous = ''; previous !== masked; ) {
    previous = masked;
    masked = masked.replaceAll(/\{[^{}]*\}/g, mask);
  }

  return masked;
}

/**
 * Two spaces after a sentence are an old typing convention, and a gap on a single line is a typo,
 * so neither is a column.
 */
function hasAlignedColumns(lines: readonly BodyLine[]): boolean {
  const masked = maskCode(lines.map((body) => body.text).join('\n')).split('\n');
  const seen = new Set<number>();

  for (const line of masked) {
    const columns = new Set([...line.matchAll(/[^\s.!?][^\S\n]{2,}(?=\S)/g)].map((gap) => gap.index + gap[0].length));

    if ([...columns].some((column) => seen.has(column))) {
      return true;
    }

    for (const column of columns) {
      seen.add(column);
    }
  }

  return false;
}

function structureOf(lines: readonly BodyLine[]): Structure | undefined {
  const trimmed = lines.map((line) => line.text.trim()).join('\n');
  const texts = replaceKeepingLines(trimmed, CODE_SPAN, '``').split('\n');

  /**
   * Types like `{string | null}`, links like `{@link a | b}`, and URLs hold pipes and dashes
   * that aren't layout.
   */
  const proseLines = stripNonProse(trimmed).split('\n');

  // the parser only accepts a whole paragraph as code when it is code, since two words in a row are a syntax error
  if (isCode(lines.map((line) => line.text.trim()))) {
    return { tier: 'code', reason: 'code' };
  }

  let layout: string | undefined;
  let codeLike = false;

  // a hard break on the last line of a paragraph ends the paragraph instead, as in Markdown
  let manual = lines.slice(0, -1).some((line) => line.hardBreak) ? 'hard line break' : undefined;

  for (const [position, line] of texts.entries()) {
    const prose = proseLines[position].trim();

    layout ??= layoutReason(prose, lines[position]?.text ?? '');

    // a single line that looks like code may be prose, like one that starts with `import them from`
    if (isCodeLine(line.trim())) {
      codeLike = true;
    } else if (isMarkup(prose)) {
      manual ??= 'markup';
    } else if ((prose.match(/\|/g)?.length ?? 0) >= 2) {
      manual ??= 'pipes';
    } else if (ARROWS_OR_RULES.test(prose)) {
      manual ??= 'arrows or rules';
    }
  }

  layout ??= hasAlignedColumns(lines) ? 'aligned columns' : undefined;

  if (layout) {
    return { tier: 'layout', reason: layout };
  }

  if (codeLike) {
    return { tier: 'code-like', reason: 'code-like line' };
  }

  /**
   * One term per line, like `width - the maximum width` above `height - the maximum height`, may be
   * a definition list.
   */
  if (texts.filter((text) => DEFINITION.test(text.trim())).length >= 2) {
    manual ??= 'definition-like lines';
  }

  return manual ? { tier: 'manual', reason: manual } : undefined;
}

/**
 * A Markdown code fence closes only with the character it opened with, repeated at least as
 * often. A tilde fence inside a backtick block, or three backticks inside a four-backtick
 * block, doesn't end it.
 */
class FenceTracker {
  private _open: string | undefined;

  isInside(): boolean {
    return this._open !== undefined;
  }

  next(text: string): boolean {
    const trimmed = text.trim();

    if (this._open === undefined) {
      this._open = FENCE.exec(trimmed)?.[0];

      return this._open !== undefined;
    }

    if (trimmed.startsWith(this._open) && new RegExp(`^\\${this._open[0]}+$`).test(trimmed)) {
      this._open = undefined;
    }

    return true;
  }
}

function segment(lines: readonly BodyLine[]): RawParagraph[] {
  const paragraphs: RawParagraph[] = [];
  const fence = new FenceTracker();

  let current: RawParagraph | undefined;
  let inCodeTag = false;

  const flush = (): void => {
    if (current) {
      while (current.lines.length > 1 && !current.lines.at(-1)?.text.trim()) {
        current.lines.pop();
      }

      paragraphs.push(current);

      current = undefined;
    }
  };

  const start = (kind: ParagraphKind, line: BodyLine, marker = '', reason?: string): void => {
    flush();

    current = { kind, lines: [line], marker, reason };
  };

  for (const line of lines) {
    const { text } = line;

    if (inCodeTag) {
      /**
       * A fence inside the example may hold a line like `@decorator()`, which only starts a tag
       * outside of it.
       */
      if (fence.isInside() || !JSDOC_TAG.test(text)) {
        fence.next(text);
        current?.lines.push(line);

        continue;
      }

      inCodeTag = false;
    }

    if (fence.isInside()) {
      current?.lines.push(line);
      fence.next(text);

      if (!fence.isInside()) {
        flush();
      }

      continue;
    }

    if (line.verbatim) {
      start('code', line, '', 'directive');
      flush();

      continue;
    }

    if (!text.trim()) {
      flush();

      continue;
    }

    if (fence.next(text)) {
      start('code', line, '', 'code block');

      continue;
    }

    if (/^\s/.test(text)) {
      const holdsProse = current?.kind === 'list' || (current?.kind === 'tag' && !current.reason);
      const nested = holdsProse ? NESTED_LIST_MARKER.exec(text) : null;

      if (nested) {
        start('list', line, nested[0]);
      } else if (current && (current.kind === 'list' || current.kind === 'tag' || current.reason === 'indented')) {
        current.lines.push(line);
      } else {
        start('code', line, '', 'indented');
      }

      continue;
    }

    const tag = JSDOC_TAG.exec(text);

    if (tag) {
      start('tag', line, '', PROSE_TAGS.has(tag[1]) ? undefined : `@${tag[1]} tag`);

      inCodeTag = CODE_TAGS.has(tag[1]);

      continue;
    }

    const marker = LIST_MARKER.exec(text);

    if (marker) {
      start('list', line, marker[0]);

      continue;
    }

    // like Markdown, an unindented line right after a list item lazily continues it
    if (current && (current.kind === 'prose' || current.kind === 'tag' || current.kind === 'list')) {
      current.lines.push(line);

      continue;
    }

    start('prose', line);
  }

  flush();

  return paragraphs;
}

function startsLine(token: string, next: string | undefined): boolean {
  return startsBlock(token) || LINE_DIRECTIVE.test(next === undefined ? token : `${token} ${next}`);
}

function visualLength(text: string, tabWidth: number): number {
  return text.replaceAll('\t', ' '.repeat(tabWidth)).length;
}

function sourceLineLength(line: BodyLine, tabWidth: number): number {
  // the text holds the indentation for comments without a prefix, like `other` block comments
  return visualLength(`${line.prefix}${line.text.trimEnd()}`, tabWidth);
}

/**
 * In legacy width/tolerance mode, an indivisible token is exempt because wrapping cannot
 * make it fit.
 */
function overflowIssues(lines: readonly BodyLine[], options: AnalyzeOptions): IssueReport[] {
  const issues: IssueReport[] = [];
  const limit = options.maxWidth ?? options.width + options.tolerance;

  for (const line of lines) {
    const length = sourceLineLength(line, options.tabWidth);

    if (length <= limit) {
      continue;
    }

    if (options.maxWidth !== undefined) {
      issues.push(lineIssue('overflow', line, options));

      continue;
    }

    const prefixLength = visualLength(`${line.prefix}${/^\s*/.exec(line.text)?.[0] ?? ''}`, options.tabWidth);
    const tokens = bindLineStarts(tokenize(line.text), startsLine);

    if (tokens.length > 1 && tokens.every((token) => prefixLength + token.length <= limit)) {
      issues.push(lineIssue('overflow', line, options));
    }
  }

  return issues;
}

function lineIssue(type: IssueType, line: BodyLine, options: AnalyzeOptions): IssueReport {
  return { type, tier: ISSUE_TIERS[type], line: line.index + 1, length: sourceLineLength(line, options.tabWidth) };
}

function stripBlockSyntax(text: string): string {
  return text
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*\*(?=\s|$)/, '');
}

function bannerIssues(paragraph: RawParagraph, options: AnalyzeOptions): IssueReport[] {
  const verbatim = ['code block', 'indented', 'legal comment'];

  if (!options.style || (paragraph.reason !== undefined && verbatim.includes(paragraph.reason))) {
    return [];
  }

  const banners = paragraph.lines.filter((line) => {
    const text = paragraph.kind === 'other' ? stripBlockSyntax(line.text) : line.text;

    return isBanner(text) || (paragraph.kind === 'other' && /^\s*\/\*{3,}|\*{3,}\/\s*$/.test(line.text));
  });

  return banners.map((line) => lineIssue('banner', line, options));
}

function styleIssues(paragraph: RawParagraph, options: AnalyzeOptions): IssueReport[] {
  if (!options.style) {
    return [];
  }

  const byIndex = new Map(paragraph.lines.map((line) => [line.index, line]));

  const lines = paragraph.lines.map((line) => {
    return { index: line.index, text: paragraph.kind === 'other' ? stripBlockSyntax(line.text) : line.text };
  });

  return findStyleIssues(lines).flatMap((issue) => {
    const line = byIndex.get(issue.index);

    return line ? [lineIssue(issue.type, line, options)] : [];
  });
}

function bindTagHead(tokens: readonly string[]): string[] {
  let end = 1;

  if (tokens[end]?.startsWith('{')) {
    end += 1;
  }

  if (NAMED_TAGS.has(tokens[0].slice(1)) && end < tokens.length) {
    end += 1;
  }

  if (tokens[end] === '-') {
    end += 1;
  }

  return [tokens.slice(0, end).join(' '), ...tokens.slice(end)];
}

/**
 * A paragraph without a structure, like a single-line block comment, is prose that just can't be
 * rewrapped, so it's checked like text laid out by hand.
 */
function keptIssues(paragraph: RawParagraph, structure: Structure | undefined, options: AnalyzeOptions): IssueReport[] {
  const tier = structure?.tier ?? 'manual';

  return byLine([
    ...(tier === 'manual' || tier === 'code-like' ? overflowIssues(paragraph.lines, options) : []),
    ...(tier === 'code' || tier === 'code-like' ? [] : styleIssues(paragraph, options)),
    ...bannerIssues(paragraph, options),
  ]);
}

function byLine(issues: readonly IssueReport[]): IssueReport[] {
  const unique = new Map(issues.map((issue) => [`${issue.line}:${issue.type}`, issue]));

  return [...unique.values()].toSorted((a, b) => a.line - b.line);
}

function sameLayout(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return a.length === b.length && a.every((words, position) => words.join(' ') === b[position].join(' '));
}

function analyzeParagraph(paragraph: RawParagraph, options: AnalyzeOptions): ParagraphReport {
  const first = paragraph.lines[0];
  const last = paragraph.lines.at(-1) ?? first;
  const base = { kind: paragraph.kind, startLine: first.index + 1, endLine: last.index + 1 };

  if (paragraph.kind === 'code') {
    return {
      ...base,
      reflowable: false,
      reason: paragraph.reason,
      issues: bannerIssues(paragraph, options),
      suggestion: null,
    };
  }

  if (paragraph.kind === 'tag' && paragraph.reason) {
    const codeTag = CODE_TAGS.has(JSDOC_TAG.exec(first.text)?.[1] ?? '');
    const issues = codeTag ? [] : overflowIssues(paragraph.lines, options);

    return { ...base, reflowable: false, reason: paragraph.reason, issues, suggestion: null };
  }

  if (paragraph.kind === 'other') {
    const fence = new FenceTracker();

    const prose = {
      ...paragraph,
      lines: paragraph.lines.filter((line) => !fence.next(stripBlockSyntax(line.text))),
    };

    const structure = structureOf(
      prose.lines.map((line) => {
        return { ...line, text: stripBlockSyntax(line.text) };
      }),
    );

    const issues = keptIssues(prose, structure, options);

    return { ...base, reflowable: false, reason: paragraph.reason, issues, suggestion: null };
  }

  const keep = (structure: Structure): ParagraphReport => {
    const issues = keptIssues(paragraph, structure, options);

    return { ...base, reflowable: false, reason: structure.reason, issues, suggestion: null };
  };

  const structure = structureOf(paragraph.lines);

  if (structure) {
    return keep(structure);
  }

  const prefix = first.prefix;
  const prefixLength = visualLength(prefix, options.tabWidth);
  const hang = ' '.repeat(paragraph.marker.length);
  const firstLimit = options.width - prefixLength - paragraph.marker.length;
  const restLimit = options.width - prefixLength - hang.length;

  const currentLines = paragraph.lines.map((line, position) =>
    bindLineStarts(tokenize(position === 0 ? line.text.slice(paragraph.marker.length) : line.text), startsLine),
  );

  const tokens = tokenize(currentLines.flat().join(' '));

  const layoutOptions = {
    ...options,
    tolerance:
      options.maxWidth === undefined
        ? options.tolerance
        : Math.min(options.tolerance, options.maxWidth - options.width),
    parentheticalOverflow: options.maxWidth === undefined ? undefined : options.maxWidth - options.width,
    keepFirstLine: paragraph.kind === 'tag',
  };

  const layOut = (from: readonly string[], settings: LayoutOptions, extra: number) => {
    const even = layoutTokens(from, firstLimit + extra, restLimit + extra, settings);

    return { even, wrapped: breakAfterSentence(even, firstLimit + extra, restLimit + extra, settings) };
  };

  const units = bindLineStarts(paragraph.kind === 'tag' ? bindTagHead(tokens) : tokens, startsLine);

  // the first and the other lines have the same limit, since the hanging indent is as long as the marker
  const hardLimit = restLimit + (options.maxWidth === undefined ? options.tolerance : options.maxWidth - options.width);
  const written = currentLines.map((words) => ` ${words.join(' ')} `);

  /**
   * Text that stays on one line, like a code span, may only be longer than the limit when it
   * already is on one line, so a rewrap never adds a line that is too long.
   */
  const staysInLimit = (unit: string): boolean => {
    return unit.length <= hardLimit || written.some((line) => line.includes(` ${unit} `));
  };

  // a code span or `{...}` group that continues on the next line would be joined into one line that is too long
  if (!units.every((unit) => staysInLimit(unit))) {
    return keep({ tier: 'manual', reason: 'unbreakable text across lines' });
  }

  const bodyOf = (lines: readonly (readonly string[])[]): BodyLine[] => {
    return lines.map((words, position) => {
      const text = `${position === 0 ? paragraph.marker : hang}${words.join(' ')}`;

      return { ...first, text, verbatim: false, hardBreak: HARD_BREAK.test(text) };
    });
  };

  /**
   * Analyzing the rewrap must find the same prose, so when a new line's start or end would read as
   * structure, like two lines that start with `term - `, the first word of the line that tips it
   * moves up a line. Without such a layout, or when the text reads as structure on a single line,
   * no rewrap reads as the same prose, and the paragraph is kept as written. The lines get `extra`
   * columns more than the width allows.
   */
  const settle = (settings: LayoutOptions, extra = 0): { even: string[][]; wrapped: string[][] } | Structure => {
    let current = units;
    let { even, wrapped } = layOut(current, settings, extra);

    for (;;) {
      const body = bodyOf(wrapped);
      const rewrap = structureOf(body);

      if (!rewrap) {
        return { even, wrapped };
      }

      // the first line has no line to move a word up to, so the first word of the second line joins it instead
      const tipping = body.findIndex((_, position) => structureOf(body.slice(0, position + 1)) !== undefined);
      const start = wrapped.slice(0, Math.max(tipping, 1)).flat().length;
      const pair = `${current[start - 1]} ${current[start]}`;

      if (body.length < 2 || !staysInLimit(pair)) {
        const reading = rewrap.tier === 'code-like' ? 'code' : rewrap.reason;

        return { tier: 'manual', reason: `rewrap would read as ${reading}` };
      }

      current = current.toSpliced(start - 1, 2, pair);
      ({ even, wrapped } = layOut(current, settings, extra));
    }
  };

  /**
   * Lays the paragraph out for a width that is `extra` columns wider. The columns come out of the
   * tolerance and out of the room that parentheticals have, so the hard limit stays where it is.
   */
  const layoutAt = (extra: number): { even: string[][]; wrapped: string[][] } | Structure => {
    const settings = {
      ...layoutOptions,
      tolerance: layoutOptions.tolerance - extra,
      parentheticalOverflow:
        layoutOptions.parentheticalOverflow === undefined ? undefined : layoutOptions.parentheticalOverflow - extra,
    };

    const settled = settle(settings, extra);

    // the extra lines that keep a line from sticking out can read as structure where the fewest lines don't
    return 'wrapped' in settled ? settled : settle({ ...settings, keepSteps: true }, extra);
  };

  const layout = layoutAt(0);

  if (!('wrapped' in layout)) {
    return keep(layout);
  }

  const { even, wrapped } = layout;
  const matchesLayout = sameLayout(wrapped, currentLines);

  const lineIssues: LineIssue[] = [];
  const overflow: IssueReport[] = options.maxWidth === undefined ? [] : overflowIssues(paragraph.lines, options);

  if (!matchesLayout) {
    const hasExtraLines = currentLines.length > wrapped.length;

    if (options.maxWidth === undefined) {
      overflow.push(...overflowIssues(paragraph.lines, options));
    }

    lineIssues.push(
      ...findLineIssues(currentLines, firstLimit, restLimit, layoutOptions).filter(
        (issue) => issue.type !== 'overflow' && (issue.type !== 'underfill' || hasExtraLines),
      ),
    );

    if (hasWidow(currentLines) && !hasWidow(wrapped)) {
      lineIssues.push({ type: 'widow', line: currentLines.length - 1 });
    }

    /**
     * The agent may keep a word that a possible orphan is about where it is, so a layout that only
     * differs from the suggestion by those words is no verdict. Anything else about it still is.
     */
    const keepsOnlyOrphans = (): boolean => {
      const free = settle({ ...layoutOptions, avoidSentenceOrphans: false });

      return !('wrapped' in free) || sameLayout(free.wrapped, currentLines);
    };

    const keepsOnlySentenceStarts = (): boolean => {
      const free = settle({ ...layoutOptions, ignoreSentenceStarts: true });

      return 'wrapped' in free && (sameLayout(free.even, currentLines) || sameLayout(free.wrapped, currentLines));
    };

    /**
     * Whether a parenthetical stays on one line is for the agent to decide, so a layout that
     * matches the suggestion up to a line that ends inside a parenthetical that the suggestion
     * keeps whole, and the rewrap of the rest after it, is no verdict.
     */
    const splitsOnlyParenthetical = (line: number): boolean => {
      if (layoutOptions.parentheticalOverflow === undefined) {
        return false;
      }

      const tokenCount = (lines: readonly (readonly string[])[]) => tokenize(lines.flat().join(' ')).length;
      const end = tokenCount(currentLines.slice(0, line + 1));
      const group = parentheticalAround(tokens, end, restLimit + layoutOptions.parentheticalOverflow);

      if (!group) {
        return false;
      }

      const keepsGroup = wrapped.every((_, position) => {
        const breakAt = tokenCount(wrapped.slice(0, position + 1));

        return breakAt <= group.start || breakAt >= group.end;
      });

      if (!keepsGroup) {
        return false;
      }

      const restOptions = { ...layoutOptions, keepFirstLine: false };
      const rest = bindLineStarts(tokens.slice(end), startsLine);
      const restLines = layoutTokens(rest, restLimit, restLimit, restOptions);

      return sameLayout(breakAfterSentence(restLines, restLimit, restLimit, restOptions), currentLines.slice(line + 1));
    };

    if (overflow.length === 0 && (currentLines.length === wrapped.length || options.maxWidth !== undefined)) {
      const line = Math.max(
        wrapped.findIndex((words, position) => words.join(' ') !== currentLines[position]?.join(' ')),
        0,
      );

      /**
       * Lines that only miss the break after a sentence, or end with the first words of one, are a
       * hint, since a heuristic decides where a sentence ends.
       */
      if (lineIssues.length === 0 && (sameLayout(even, currentLines) || keepsOnlySentenceStarts())) {
        lineIssues.push({ type: 'orphan', line });
      } else if (lineIssues.length === 0) {
        lineIssues.push({ type: splitsOnlyParenthetical(line) ? 'split-parenthetical' : 'unbalanced', line });
      } else if (
        lineIssues.every((issue) => issue.type === 'orphan') &&
        !sameLayout(even, currentLines) &&
        !keepsOnlyOrphans()
      ) {
        lineIssues.push({ type: 'unbalanced', line });
      }
    }
  }

  const isVerdict = (issue: LineIssue): boolean => ISSUE_TIERS[issue.type] === 'verdict';

  /**
   * The tolerance is room past the width, so a paragraph that already has the layout for a width
   * within the tolerance is fine as it is.
   */
  const matchesWiderLayout = (): boolean => {
    for (let extra = 1; extra <= layoutOptions.tolerance; extra += 1) {
      const wider = layoutAt(extra);

      if ('wrapped' in wider && sameLayout(wider.wrapped, currentLines)) {
        return true;
      }
    }

    return false;
  };

  /**
   * A paragraph that only has hints keeps them and its suggestion, since a hint is for the agent to
   * decide. Only verdicts go, and the suggestion then keeps the lines as they are.
   */
  const accepted = lineIssues.some((issue) => isVerdict(issue)) && matchesWiderLayout();
  const suggested = accepted ? currentLines : wrapped;

  const suggestion = suggested.map(
    (words, position) => `${prefix}${position === 0 ? paragraph.marker : hang}${words.join(' ')}`,
  );

  const wrapIssues = lineIssues
    .filter((issue) => !accepted || !isVerdict(issue))
    .map((issue) => lineIssue(issue.type, paragraph.lines[issue.line], options));

  const issues = byLine([...overflow, ...wrapIssues, ...styleIssues(paragraph, options)]);

  return { ...base, reflowable: true, issues, suggestion };
}

function computeLineStarts(source: string): number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source.codePointAt(index) === 0x0a) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function lineOf(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (lineStarts[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
}

interface CommentShape {
  readonly kind: CommentKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly paragraphs: RawParagraph[];
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function shapeBlock(
  comment: ParsedComment,
  sourceLines: readonly string[],
  lineStarts: readonly number[],
): CommentShape {
  const startLine = lineOf(lineStarts, comment.start);
  const endLine = lineOf(lineStarts, comment.end - 1);
  const kind: CommentKind = comment.value.startsWith('*') ? 'jsdoc' : 'block';
  const lines = sourceLines.slice(startLine, endLine + 1);

  const wholeComment = (paragraphKind: ParagraphKind, reason: string): CommentShape => {
    const otherLines = lines.map((text, offset) => {
      return { index: startLine + offset, prefix: '', text, verbatim: false, hardBreak: false };
    });

    return { kind, startLine, endLine, paragraphs: [{ kind: paragraphKind, marker: '', reason, lines: otherLines }] };
  };

  const value = comment.value.replace(/^\*/, '');

  // a code span only names a marker, like the `@license` in a comment that explains legal comments
  if (LEGAL_COMMENT.test(replaceKeepingLines(comment.value, CODE_SPAN, '``'))) {
    return wholeComment('code', 'legal comment');
  }

  if (LINE_DIRECTIVE.test(value) || BLOCK_DIRECTIVE.test(value)) {
    return wholeComment('code', 'directive');
  }

  const other = (): CommentShape => {
    return wholeComment(
      'other',
      startLine === endLine ? 'single-line block comment' : 'unsupported block comment layout',
    );
  };

  if (startLine === endLine || !/^\s*\/\*\*?$/.test(lines[0]) || !/^\s*\*\/$/.test(lines.at(-1) ?? '')) {
    return other();
  }

  const body: BodyLine[] = [];
  const inner = lines.slice(1, -1);

  for (const [offset, line] of inner.entries()) {
    const match = /^(\s*\*)( ?)(.*)$/.exec(line);

    if (!match) {
      return other();
    }

    const [, star, space, text] = match;

    body.push({
      index: startLine + 1 + offset,
      prefix: `${star} `,
      text: text.trimEnd(),
      verbatim: (!space && text.length > 0) || LINE_DIRECTIVE.test(text),
      hardBreak: HARD_BREAK.test(text),
    });
  }

  return { kind, startLine, endLine, paragraphs: segment(body) };
}

function ownsLines(comment: ParsedComment, source: string, lineStarts: readonly number[]): boolean {
  const startLine = lineOf(lineStarts, comment.start);
  const before = source.slice(lineStarts[startLine], comment.start);
  const endLine = lineOf(lineStarts, comment.end - 1);
  const lineEnd = lineStarts[endLine + 1] ?? source.length;
  const after = source.slice(comment.end, lineEnd);

  return /^[\t ]*$/.test(before) && /^[\t ]*\r?\n?$/.test(after);
}

/**
 * Only a single-line block comment or prose without structure can stay on one line past the width.
 */
function singleLineLength(paragraph: RawParagraph, options: AnalyzeOptions): number {
  const [first] = paragraph.lines;

  if (paragraph.kind === 'other' && paragraph.reason === 'single-line block comment') {
    return sourceLineLength(first, options.tabWidth);
  }

  if (paragraph.kind !== 'prose' || structureOf(paragraph.lines)) {
    return Infinity;
  }

  const text = tokenize(paragraph.lines.map((line) => line.text).join(' ')).join(' ');

  return visualLength(first.prefix, options.tabWidth) + text.length;
}

export const BYTE_ORDER_MARK = '\uFEFF';

/**
 * Most toolchains accept JSX in a `.js` file, and a file without JSX parses the same either way.
 */
function parseSource(filename: string, source: string): ReturnType<typeof parseSync> {
  return parseSync(filename, source, filename.endsWith('.js') ? { lang: 'jsx' } : undefined);
}

function describeFailure(errors: readonly OxcError[], lineStarts: readonly number[]): SyntaxFailure {
  const [first] = errors;
  const offset = first.labels.at(0)?.start;

  return { message: first.message, line: offset === undefined ? undefined : lineOf(lineStarts, offset) + 1 };
}

/**
 * Finds all own-line block and JSDoc comments in a JavaScript or TypeScript source file and reports
 * how each paragraph deviates from a greedy wrap at `options.width`. Line comments (`//`) are never
 * analyzed. A source with a syntax error that stops the parser has no reports.
 */
export function analyzeSource(source: string, filename: string, options: AnalyzeOptions): CommentReport[] {
  return inspectSource(source, filename, options).comments;
}

/**
 * Analyzes a source like `analyzeSource`, and also tells a source without comments apart from one
 * that the parser can't read.
 */
export function inspectSource(source: string, filename: string, options: AnalyzeOptions): SourceAnalysis {
  if (options.maxWidth !== undefined && (!Number.isInteger(options.maxWidth) || options.maxWidth < options.width)) {
    throw new Error('comments: maxWidth must be an integer at least as large as width');
  }

  // a byte order mark is no text, so a comment on the first line owns its lines and is measured without the mark
  const text = source.startsWith(BYTE_ORDER_MARK) ? source.slice(1) : source;
  const { program, comments, errors } = parseSource(filename, text);
  const lineStarts = computeLineStarts(text);

  /**
   * The parser returns an empty program when it stops at a syntax error, and it has only seen
   * the comments before that error. An error that it recovers from, like a `return` outside of
   * a function, leaves the program and its comments complete.
   */
  if (errors.length > 0 && program.body.length === 0) {
    return { comments: [], syntaxError: describeFailure(errors, lineStarts) };
  }

  const sourceLines = text.split('\n').map((line) => stripCarriageReturn(line));

  // drop a leading hashbang, which some parser versions report as a comment
  const parsed = (comments as ParsedComment[]).filter((comment) => !(comment.start === 0 && text.startsWith('#!')));
  const reports: CommentReport[] = [];

  const blocks = parsed.filter((comment) => {
    return (
      comment.type === 'Block' && ownsLines(comment, text, lineStarts) && !comment.value.includes(IGNORE_DIRECTIVE)
    );
  });

  for (const block of blocks) {
    const shape = shapeBlock(block, sourceLines, lineStarts);

    const singleLineWidth = Math.max(
      options.width,
      Math.min(options.singleLineWidth ?? options.width, options.maxWidth ?? Infinity),
    );

    // staying on one line always saves a line, so the tolerance applies on top of the single-line width
    const singleLineLimit = Math.min(singleLineWidth + options.tolerance, options.maxWidth ?? Infinity);
    const singleLine = shape.paragraphs.length === 1 ? singleLineLength(shape.paragraphs[0], options) : Infinity;

    const paragraphOptions =
      singleLine <= singleLineLimit ? { ...options, width: Math.max(singleLineWidth, singleLine) } : options;

    const lines = sourceLines.slice(shape.startLine, shape.endLine + 1);

    reports.push({
      file: filename,
      kind: shape.kind,
      startLine: shape.startLine + 1,
      endLine: shape.endLine + 1,
      indent: /^[\t ]*/.exec(lines[0])?.[0] ?? '',
      width: options.width,
      maxWidth: options.maxWidth,
      lengths: lines.map((line) => visualLength(line.trimEnd(), options.tabWidth)),
      text: lines.join('\n'),
      paragraphs: shape.paragraphs.map((paragraph) => analyzeParagraph(paragraph, paragraphOptions)),
    });
  }

  return { comments: reports };
}

/**
 * Whether the comment has any issue, including hints, which makes it worth handing to the agent.
 */
export function isSuspicious(report: CommentReport): boolean {
  return report.paragraphs.some((paragraph) => paragraph.issues.length > 0);
}

/**
 * Whether the comment has an issue that isn't a hint, so it breaks the rules no matter what
 * the agent decided.
 */
export function hasVerdictIssues(report: CommentReport): boolean {
  return report.paragraphs.some((paragraph) => paragraph.issues.some((issue) => issue.tier === 'verdict'));
}

/**
 * Returns the comment's source text with every prose paragraph replaced by its suggestion.
 * Code, tables, diagrams, and similar paragraphs are kept as they are.
 */
export function rewrapComment(report: CommentReport): string {
  const lines = report.text.split('\n');

  const paragraphs = report.paragraphs
    .filter((paragraph) => paragraph.suggestion !== null)
    .toSorted((a, b) => b.startLine - a.startLine);

  for (const paragraph of paragraphs) {
    const start = paragraph.startLine - report.startLine;

    lines.splice(start, paragraph.endLine - paragraph.startLine + 1, ...(paragraph.suggestion ?? []));
  }

  return lines.join('\n');
}

const POSITION_KEYS = new Set(['start', 'end', 'range', 'loc']);

/**
 * Returns the syntax tree of the source as JSON, without positions or comments, used to verify
 * that only comments changed. Moving or rewording a comment keeps it the same, while any change
 * to a string, template, regex, JSX text, or where a statement ends changes it. A source that
 * doesn't parse has no tree to compare, so all of its text counts.
 */
export function codeFingerprint(source: string, filename: string): string {
  const { program, errors } = parseSource(filename, source);

  if (errors.length > 0) {
    return JSON.stringify({ source, errors: errors.map((error) => error.message) });
  }

  // a BigInt literal's value is a `bigint`, which JSON can't hold, but its `raw` text already tells it apart
  return JSON.stringify(program, (key, value: unknown) =>
    POSITION_KEYS.has(key) || typeof value === 'bigint' ? undefined : value,
  );
}
