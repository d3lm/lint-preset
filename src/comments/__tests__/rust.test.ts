import {
  analyzeSource,
  codeFingerprint,
  hasVerdictIssues,
  inspectSource,
  rewrapComment,
  type AnalyzeOptions,
  type CommentReport,
} from '../analyze.js';
import { isRustCode } from '../rust.js';
import { tokenize } from '../wrap.js';
import { randomComments } from './helpers/random-comments.js';
import { renderComment, RUST_FORMS } from './helpers/rust-forms.js';

const options: AnalyzeOptions = { width: 80, tabWidth: 4, tolerance: 0, avoidSentenceOrphans: true, style: true };

function analyze(source: string, overrides: Partial<AnalyzeOptions> = {}): CommentReport[] {
  return analyzeSource(source, 'lib.rs', { ...options, ...overrides });
}

function fix(source: string, overrides: Partial<AnalyzeOptions> = {}): string {
  const lines = source.split('\n');

  for (const comment of analyze(source, overrides).toReversed()) {
    lines.splice(comment.startLine - 1, comment.endLine - comment.startLine + 1, ...rewrapComment(comment).split('\n'));
  }

  return lines.join('\n');
}

function summary(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
  return analyze(source, overrides).map((comment) => {
    const paragraphs = comment.paragraphs.map((paragraph) => {
      return `${paragraph.kind}${paragraph.reason ? ` (${paragraph.reason})` : ''}`;
    });

    return `${comment.startLine}-${comment.endLine} ${comment.kind}: ${paragraphs.join(', ')}`;
  });
}

// the words of a source, without the markers of comments and their lines
function words(source: string): string[] {
  return source.split(/\s+/).filter((word) => !/^(?:\/\/[/!]|\/\*[*!]?|\*\/?)$/.test(word));
}

function issues(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
  return analyze(source, overrides).flatMap((comment) =>
    comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
  );
}

// the text of a comment line without its prefix, indentation, and list marker
function textOf(line: string): string {
  return line.replace(/^\s*(?:\/\/[/!]|\*)\s*(?:(?:[-*+]|\d+[.)])\s+)?/, '');
}

// whether one line of the text holds the link as a whole
function isOnOneLine(text: string, link: string): boolean {
  return text.split('\n').some((line) => line.includes(link));
}

describe('finding Rust comments', () => {
  it('finds outer and inner doc comments of each style, and plain block comments', () => {
    const source = [
      '//! Inner line doc.',
      '',
      '/*!',
      ' * Inner block doc.',
      ' */',
      '',
      '/// Outer line doc.',
      'pub fn a() {}',
      '',
      '/**',
      ' * Outer block doc.',
      ' */',
      'pub fn b() {}',
      '',
      '/*',
      ' * Plain block comment.',
      ' */',
      'fn c() {}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual([
      '1-1 inner-line-doc: prose',
      '3-5 inner-block-doc: prose',
      '7-7 outer-line-doc: prose',
      '10-12 outer-block-doc: prose',
      '15-17 block: prose',
    ]);
  });

  it('reads comments that look like doc comments but are not as plain comments', () => {
    const source = [
      '// A plain line comment.',
      '//// Four slashes make a plain line comment.',
      '/*** Three stars make a plain block comment. */',
      '/**/',
      'fn a() {}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual([
      '3-3 block: other (single-line block comment)',
      '4-4 block: other (single-line block comment)',
    ]);

    expect(summary(source, { width: 20, maxWidth: 30 })).toEqual([
      '1-2 line: prose (line comment)',
      '3-3 block: other (single-line block comment)',
      '4-4 block: other (single-line block comment)',
    ]);
  });

  it('only reports a run of plain line comments with a line past the maximum, outside of doc comments', () => {
    const long = 'a plain comment that is longer than the maximum width of a line';

    const source = [
      'fn a() {',
      `    // ${long}`,
      '    //',
      '    // let value = compute(first_argument, second_argument, third_argument);',
      '}',
      '',
      `/// ${long}`,
      `// ${long}`,
      'fn b() {}',
      '',
    ].join('\n');

    const settings = { width: 40, maxWidth: 60 };

    expect(issues(source, settings)).toEqual(['2:overflow', '7:overflow', '8:overflow']);

    expect(summary(source, settings)).toEqual([
      '2-4 line: prose (line comment), prose (line comment)',
      '7-7 outer-line-doc: prose',
      '8-8 line: prose (line comment)',
    ]);
  });

  it('never reads comment markers inside strings, raw strings, characters, or lifetimes', () => {
    const source = [
      "fn a<'a>(x: &'a str) -> char {",
      '    let s = "// not a comment /* either */";',
      '    let r = r#"/// "still" a string /*"#;',
      '    let b = br##"/*! raw bytes */ "#  "##;',
      "    let c = '/';",
      "    let d = '\"';",
      "    let e = b'*';",
      '    let f = c"/** C string */";',
      '    x.chars().next().unwrap_or(c)',
      '}',
      '',
      '/// The only comment.',
      'fn b() {}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual(['12-12 outer-line-doc: prose']);
  });

  it('reads nested block comments as one comment', () => {
    const source = ['/*', ' * Outer text /* nested', ' * comment */ and more text.', ' */', 'fn a() {}', ''].join('\n');

    expect(summary(source)).toEqual(['1-4 block: prose']);

    expect(fix(source)).toBe(
      ['/*', ' * Outer text /* nested comment */ and more text.', ' */', 'fn a() {}', ''].join('\n'),
    );
  });

  it('skips a shebang, but not an inner attribute on the first line', () => {
    const shebang = ['#!/usr/bin/env run-cargo-script', '/// A doc comment.', 'fn main() {}', ''].join('\n');
    const attribute = ['#![allow(dead_code)]', '/// A doc comment.', 'fn main() {}', ''].join('\n');

    expect(summary(shebang)).toEqual(['2-2 outer-line-doc: prose']);
    expect(summary(attribute)).toEqual(['2-2 outer-line-doc: prose']);
  });

  it('skips the frontmatter of a cargo script', () => {
    const source = [
      '---',
      '[dependencies]',
      'clap = "4" # /* not a comment',
      '---',
      '',
      '//! A cargo script.',
      'fn main() {}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual(['6-6 inner-line-doc: prose']);
  });

  it('measures text after characters outside the Basic Multilingual Plane and in other scripts', () => {
    const source = [
      'const EMOJI: &str = "😀😀😀"; // 😀',
      '/// 漢字 and ünïcödé, then a sentence that is long enough to wrap at this width.',
      'fn a() {}',
      '',
    ].join('\n');

    expect(summary(source, { width: 40, maxWidth: 40 })).toEqual(['2-2 outer-line-doc: prose']);

    expect(fix(source, { width: 40, maxWidth: 40 })).toBe(
      [
        'const EMOJI: &str = "😀😀😀"; // 😀',
        '/// 漢字 and ünïcödé, then a sentence',
        '/// that is long enough to wrap',
        '/// at this width.',
        'fn a() {}',
        '',
      ].join('\n'),
    );
  });

  it('skips a source with a token that never ends, and names its line', () => {
    const comment = '/// A doc comment.\nfn a() {}\n';

    for (const [source, message, line] of [
      [`${comment}/* never closed\n`, 'unterminated block comment', 3],
      [`${comment}/* nested /* only one */ closed\n`, 'unterminated block comment', 3],
      [`${comment}fn b() {}\nconst S: &str = "open;\n`, 'unterminated double quote string', 4],
      [`${comment}const R: &str = r#"open"\n`, 'invalid or unterminated raw string', 3],
    ] as const) {
      const analysis = inspectSource(source, 'lib.rs', options);

      expect(analysis.comments, source).toEqual([]);
      expect(analysis.syntaxError, source).toEqual({ message, line });
    }
  });

  it('measures CRLF files and files with a byte order mark', () => {
    const source = '\uFEFF/// One two three four five six seven\r\n/// eight.\r\nfn a() {}\r\n';
    const [comment] = analyze(source, { width: 40, maxWidth: 40 });

    expect(comment.text).toBe('/// One two three four five six seven\n/// eight.');
    expect(comment.lengths).toEqual([37, 10]);
    expect(rewrapComment(comment)).toBe('/// One two three four five\n/// six seven eight.');
  });

  it('skips doc comments after code on the same line and comments with `comments-ignore`', () => {
    const source = [
      'struct A {',
      '    a: u8, /// A trailing doc comment.',
      '}',
      '',
      '/// comments-ignore: this whole',
      '/// run of lines stays as it is.',
      'fn b() {}',
      '',
      '/* comments-ignore',
      ' * nor this block.',
      ' */',
      '',
    ].join('\n');

    expect(summary(source)).toEqual([]);
  });
});

describe('runs of Rust line doc comments', () => {
  it('reads consecutive lines with the same marker and indentation as one comment', () => {
    const source = [
      '//! Inner docs of the crate.',
      '//! More inner docs.',
      '/// Outer docs right after them.',
      '/// More outer docs.',
      '',
      '/// A run after an empty line.',
      '// A plain line comment between.',
      '/// A run after it.',
      'mod m {',
      '    /// Indented docs.',
      '    /// More indented docs.',
      '  /// Docs with other indentation.',
      '    fn a() {}',
      '}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual([
      '1-2 inner-line-doc: prose',
      '3-4 outer-line-doc: prose',
      '6-6 outer-line-doc: prose',
      '8-8 outer-line-doc: prose',
      '10-11 outer-line-doc: prose',
      '12-12 outer-line-doc: prose',
    ]);
  });

  it('separates paragraphs at empty doc lines and keeps those lines as they are', () => {
    const source = [
      '    /// The first paragraph, which is',
      '    /// wrapped too early.',
      '    ///',
      '    /// The second paragraph.',
      '    fn a() {}',
      '',
    ].join('\n');

    expect(fix(source)).toBe(
      [
        '    /// The first paragraph, which is wrapped too early.',
        '    ///',
        '    /// The second paragraph.',
        '    fn a() {}',
        '',
      ].join('\n'),
    );
  });

  it('keeps a line without a space after the marker as written, like a JSDoc line without a space after the star', () => {
    const source = ['/// Some text that is', '///wrapped', '/// too early.', 'fn a() {}', ''].join('\n');

    expect(summary(source)).toEqual(['1-3 outer-line-doc: prose, code (directive), prose']);
    expect(fix(source)).toBe(source);
  });

  it('wraps a long single line into a run of lines with the same marker and indentation', () => {
    const source = `\t//! ${'word '.repeat(30).trim()}.\n`;

    expect(fix(source, { width: 60, maxWidth: 60, singleLineWidth: 60 })).toBe(
      [
        '\t//! word word word word word word word word word word',
        '\t//! word word word word word word word word word word',
        '\t//! word word word word word word word word word word.',
        '',
      ].join('\n'),
    );
  });

  it('keeps a comment that is one paragraph on one line up to the single-line width', () => {
    const source = `/// ${'word '.repeat(20).trim()}.\nfn a() {}\n`;

    expect(issues(source, { width: 80, maxWidth: 120, singleLineWidth: 120 })).toEqual([]);
    expect(issues(source, { width: 80, maxWidth: 120, singleLineWidth: 100 })).toEqual(['1:wide']);

    expect(fix(source, { width: 80, maxWidth: 120, singleLineWidth: 100 })).toBe(
      `/// ${'word '.repeat(15).trim()}\n/// ${'word '.repeat(5).trim()}.\nfn a() {}\n`,
    );
  });

  it('lets a line end with the first word after a comma, instead of with the word after that one too', () => {
    const settings = { width: 100, maxWidth: 120, tolerance: 5 };

    const head = [
      "/// Identifies who holds a file's operation lock. Threads are recorded rather than processes",
      '/// because threads die without their process dying through the detach and teardown paths, and',
      '/// a process-granular sweep would either miss those deaths or rip the lock from a live sibling',
    ];

    // `story` fits on the fourth line, whose 91 columns are 1 fewer than the shortest line of the rewrap
    const source = [
      ...head,
      '/// thread mid-operation. Conversions run without a process context, and their cancellation',
      '/// story is the owner-death and unregistration machinery. A volume flush also runs without one,',
      '/// and its owner releases its claim on every exit path.',
      'pub struct Owner;',
      '',
    ].join('\n');

    const rewrapped = [
      ...head,
      '/// thread mid-operation. Conversions run without a process context, and their cancellation',
      '/// story is the owner-death and unregistration machinery. A volume flush also runs without',
      '/// one, and its owner releases its claim on every exit path.',
      'pub struct Owner;',
      '',
    ].join('\n');

    // the second line has no hint, and it still ends with `paths, and` after the rewrap
    expect(issues(source, { ...settings, tolerance: 0 })).toEqual(['5:unbalanced']);
    expect(fix(source, { ...settings, tolerance: 0 })).toBe(rewrapped);
    expect(issues(rewrapped, settings)).toEqual([]);
    expect(fix(rewrapped, settings)).toBe(rewrapped);

    expect(issues(source, settings)).toEqual([]);
    expect(fix(source, settings)).toBe(source);
  });

  it('accepts lines that one word moved down puts out of line with the rewrap, within the tolerance', () => {
    const settings = { width: 100, maxWidth: 120, tolerance: 5 };

    // `meaning` fits on the first line, and the rewrap without the orphan rule moves it up, with lines of 92 to 98
    const source = [
      'impl Kernel {',
      '  /// Drains the stable ids of external files that became fully dead since the last drain,',
      '  /// meaning their link count reached zero with no open descriptions remaining and no provider',
      "  /// call for them left unanswered. A drained id's stored bytes are unreachable from this kernel,",
      '  /// so the host can reclaim them locally and propagate the deletion upstream. The log lives in',
      '  /// kernel memory, so a host that needs crash safety pairs this with a sweep of its store against',
      '  /// [`external_live_stable_ids`](Self::external_live_stable_ids) at session start. A re-claim of',
      '  /// an undrained id withdraws its retirement, because the stored bytes belong to the new use',
      '  /// from that moment.',
      '  fn drain(&mut self) {}',
      '}',
      '',
    ].join('\n');

    expect(issues(source, settings)).toEqual([]);
    expect(fix(source, settings)).toBe(source);

    const plain = { ...settings, avoidSentenceOrphans: false };

    expect(issues(source, plain)).toEqual([]);

    // the first line has 90 columns, more than 1 fewer than the 92 of the shortest line of the rewrap
    expect(issues(source, { ...plain, tolerance: 1 })).toEqual(['2:unbalanced']);
  });

  it('reports a line past the width plus the tolerance as wide', () => {
    const settings = { width: 100, maxWidth: 120, tolerance: 5 };

    const source = [
      '/*',
      ' * The errnos below follow a Linux reference run in which root and an unprivileged user ran each operation',
      " * against a writable /dev. The trusted host stands in for root. The kernel's own /dev entries behave like",
      ' * mounts pinned over their names whose attributes alone can change, so a removal, rename, or link Linux',
      ' * lets root perform on a devtmpfs node fails where the comments say so.',
      ' */',
      'fn a() {}',
      '',
    ].join('\n');

    // the first two lines have 106 columns, one more than the width plus the tolerance
    expect(issues(source, settings)).toEqual(['2:wide', '3:wide']);
    expect(issues(source, { ...settings, tolerance: 6 })).toEqual([]);
  });
});

function block(lines: string[]): string {
  return `/*\n${lines.map((line) => ` * ${line}`).join('\n')}\n */\nfn a() {}\n`;
}

function outer(lines: string[]): string {
  return `${lines.map((line) => `/// ${line}`).join('\n')}\nenum A {}\n`;
}

function inner(lines: string[]): string {
  return `impl A {\n${lines.map((line) => `  /// ${line}`).join('\n')}\n  fn b() {}\n}\n`;
}

function innerBlock(lines: string[]): string {
  return `impl A {\n  /*\n${lines.map((line) => `   * ${line}`).join('\n')}\n   */\n  fn b() {}\n}\n`;
}

describe('words at the end of a line', () => {
  const settings = { width: 100, maxWidth: 120, tolerance: 5 };

  function expectLayout(comment: (lines: string[]) => string, lines: string[]): void {
    const layout = comment(lines);

    expect(fix(comment([lines.join(' ')]), settings)).toBe(layout);
    expect(issues(layout, settings)).toEqual([]);
    expect(fix(layout, settings)).toBe(layout);
  }

  it('fills lines up to the width', () => {
    expectLayout(block, [
      'A time is a finite number of milliseconds. Linux refuses a timespec whose nanoseconds are out of',
      'range with `EINVAL` once the file is found and before it asks who the caller is, and every call',
      'that sets a time refuses one that is not finite the same way. A node then never holds a time that',
      'an index of the tree could not carry.',
    ]);

    expectLayout(block, [
      'The commit cannot report a failure, so it has to be able to rely on its plan. These tests hand',
      'it a plan that names what the file system does not hold and check that a debug build stops there,',
      'where carrying on would leave a name without its node.',
    ]);
  });

  it('moves an article to the next line', () => {
    expectLayout(block, [
      'Checks that the balance of the personal wallet follows the profile row, with the real auth',
      'provider, query cache, and realtime client. Only the auth server, the realtime server, and',
      'the database are played.',
    ]);

    expectLayout(block, [
      '`lib` decodes this format as well, and `tests/fixtures/index_decode.json` pins its decoder',
      'and this one to the same verdicts. Each vector holds a payload and whether the decode and',
      'the validation take it, so a rule that changes on one side fails the test of the other.',
    ]);
  });

  it('uses the tolerance to even the lines', () => {
    expectLayout(block, [
      'Builds a chain of nested directories one level at a time through a held dirfd, the way an unprivileged',
      'guest can, and then renames its top. The check that a directory is not moved below itself climbs from',
      "the destination, so the chain's depth never reaches the stack, and the rename runs on a thread whose",
      'stack would overflow from one frame per level.',
    ]);

    expectLayout(block, [
      'Linux takes every path as a C string, which ends at its first NUL, so no name and no symlink target',
      'on a Linux filesystem holds one. A path arrives here with its length instead, so the kernel refuses',
      "a NUL with `EINVAL` before any lookup, in either path of a call and in a symlink's target. No call",
      'can then create a name or a target that an index of the tree could not carry.',
    ]);
  });

  it('uses the tolerance to end the lines closer together, even with an article at the end of one', () => {
    expectLayout(innerBlock, [
      'Hydrates the regular file behind a description the syscall already resolved. The entries resolve',
      'the fd once and hand the same description to hydration and to the transfer, because hydration can',
      'park and a concurrent close and reopen may rebind the fd number meanwhile. Linux keeps an in-flight',
      'operation on the open file it started with, so the transfer must never re-resolve the fd after this',
      'returns. A `position` marks a positional read, which the description refuses with `ESPIPE` on an',
      'object that has no position, in the lock this step takes anyway.',
    ]);
  });

  it('ends a line with a sentence instead of with the first word of the next one', () => {
    expectLayout(innerBlock, [
      'Waits until the open returned, with what it returned, or waits in the kernel, with `None`.',
      'No other call of the sequence waits meanwhile, so a waiter in the kernel is the open.',
    ]);

    expectLayout(innerBlock, [
      'Puts the fd a blocking open returned into its slot, which is empty again after a failure.',
      'The fd turns nonblocking like the fd of every other slot, because no step may block the',
      'thread that runs the sequence.',
    ]);
  });

  it('moves the first word after a comma to the next line, unless it only joins the two sides', () => {
    expectLayout(outer, [
      'Selects how `utimensat` updates one timestamp, mirroring the timespec forms of Linux.',
      '`Set` carries wall-clock milliseconds like the existing atime and mtime arguments,',
      '`Now` matches `UTIME_NOW`, and `Omit` matches `UTIME_OMIT`.',
    ]);

    expectLayout(inner, [
      "Changes a path's mode relative to a dirfd, like fchmodat(2). Linux cannot chmod a symlink,",
      'so `AT_SYMLINK_NOFOLLOW` resolving to a symlink reports `EOPNOTSUPP` (fchmodat2 semantics).',
    ]);

    expectLayout(inner, [
      'Creates an empty regular file named `name` in an already resolved parent directory,',
      'where `canonical_path` spells the path a name that turned out to be taken reports.',
    ]);
  });

  it('only hints at a layout that the words at the end of its lines alone set apart from the rewrap', () => {
    const source = outer([
      'Selects how `utimensat` updates one timestamp, mirroring the timespec forms of Linux.',
      '`Set` carries wall-clock milliseconds like the existing atime and mtime arguments, `Now`',
      'matches `UTIME_NOW`, and `Omit` matches `UTIME_OMIT`.',
    ]);

    expect(issues(source, settings)).toEqual(['2:orphan']);
    expect(issues(source, { ...settings, avoidSentenceOrphans: false })).toEqual([]);
  });
});

describe('the last line of a paragraph', () => {
  const settings = { width: 100, maxWidth: 120, tolerance: 5 };

  // the code span is too long for the first line, so two lines have 93 and 105 columns
  const twoLines = [
    "Advances a FIFO node's mtime and ctime after a write that transferred bytes, like Linux's",
    '`file_update_time` in `pipe_write`. A zero-length write leaves the timestamps alone, also like Linux.',
  ];

  const rewrapped = outer([
    "Advances a FIFO node's mtime and ctime after a write that transferred bytes, like Linux's",
    '`file_update_time` in `pipe_write`. A zero-length write leaves the timestamps alone,',
    'also like Linux.',
  ]);

  it('saves no line with a last line that ends 12 columns after the line before it', () => {
    expect(fix(outer([twoLines.join(' ')]), settings)).toBe(rewrapped);
    expect(issues(rewrapped, settings)).toEqual([]);
    expect(fix(rewrapped, settings)).toBe(rewrapped);
  });

  it('reports a last line that takes the tolerance to stick out as wide, and rewraps the paragraph', () => {
    const saved = outer(twoLines);

    expect(issues(saved, settings)).toEqual(['2:wide']);
    expect(analyze(saved, settings).some((comment) => hasVerdictIssues(comment))).toBe(true);
    expect(fix(saved, settings)).toBe(rewrapped);

    // without a tolerance, the same line is wide for ending past the width
    expect(issues(saved, { ...settings, tolerance: 0 })).toEqual(['2:wide']);
  });

  it('accepts other lines of the same number, instead of reporting an underfill, and keeps a hint', () => {
    // lines of 85, 89, and 27 columns, which only the word after a comma at the end of the first sets apart
    const written = outer([
      "Advances a FIFO node's mtime and ctime after a write that transferred bytes, like",
      "Linux's `file_update_time` in `pipe_write`. A zero-length write leaves the timestamps",
      'alone, also like Linux.',
    ]);

    expect(issues(written, settings)).toEqual(['1:orphan']);
    expect(analyze(written, settings).some((comment) => hasVerdictIssues(comment))).toBe(false);
    expect(issues(written, { ...settings, avoidSentenceOrphans: false })).toEqual([]);

    // a hint is for the agent to decide, so the suggestion is still the rewrap
    expect(fix(written, settings)).toBe(rewrapped);
  });

  it('reports a last line that a word from the line before it makes stick out', () => {
    // `past` moved down, which gives the last line 101 columns, 9 more than the longest line before it
    const source = outer([
      "Describes how a read resolves against the file's read cache. A hit carries the requested",
      'bytes, and a miss carries the fetch end the chunk loop should stream to, which extends',
      'past the requested end by one chunk bound when the read continues where the previous one stopped.',
    ]);

    expect(issues(source, settings)).toEqual(['3:wide']);

    // the rewrap takes the tolerance to end the first two lines at the same column
    expect(fix(source, settings)).toBe(
      outer([
        "Describes how a read resolves against the file's read cache. A hit carries the requested bytes, and",
        'a miss carries the fetch end the chunk loop should stream to, which extends past the requested end',
        'by one chunk bound when the read continues where the previous one stopped.',
      ]),
    );
  });

  it('measures the last line against the longest line before it, not against the line right before it', () => {
    // lines of 102, 97, and 103 columns, so the last line ends 6 columns after the second, but 1 after the first
    const lines = [
      'Prints JSON the way Prettier formats it, so a formatter that runs over the fixture changes nothing.',
      'An object takes a line for each key, and a list of numbers fills its lines to the print width.',
      '`used` counts the columns ahead of the value on its line, and `trailing` counts the comma behind it.',
    ];

    expect(fix(block([lines.join(' ')]), settings)).toBe(block(lines));
    expect(issues(block(lines), settings)).toEqual([]);
  });
});

describe('rustdoc Markdown', () => {
  const settings = { width: 60, maxWidth: 80 };

  // a link that continues on the next line of a `///` comment can't be followed in an editor
  describe('links', () => {
    const links = [
      '[`permissions`]',
      '[`count_provider_reads`]',
      '[the provider module][`provider`]',
      '[link with a destination](crate::permissions::Permission)',
      '[a link to an anchor](crate::Provider#method.reads)',
      '[`Vec<T>`]',
      '[HashMap<K, V>]',
    ];

    // the third and fourth line split a link in its text
    const source = [
      '//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for the main items, or',
      '//! [the provider module][`provider`] for the',
      '//! rest. A [link with a destination](crate::permissions::Permission) and [a link to an',
      '//! anchor](crate::Provider#method.reads) also resolve, and so do [`Vec<T>`] and [HashMap<K, V>].',
      '',
    ].join('\n');

    const wide = { width: 100, maxWidth: 120 };

    const rewrapped = [
      '//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for',
      '//! the main items, or [the provider module][`provider`] for the rest.',
      '//! A [link with a destination](crate::permissions::Permission) and',
      '//! [a link to an anchor](crate::Provider#method.reads) also resolve,',
      '//! and so do [`Vec<T>`] and [HashMap<K, V>].',
      '',
    ].join('\n');

    it('keeps every link on one line, and joins a link that continues on the next line', () => {
      const fixed = fix(source, wide);

      expect(fixed).toBe(rewrapped);
      expect(issues(fixed, wide)).toEqual([]);
      expect(fix(fixed, wide)).toBe(fixed);
      expect(codeFingerprint(fixed, 'lib.rs')).toBe(codeFingerprint(source, 'lib.rs'));
    });

    it('keeps every link on one line at any width', () => {
      for (let width = 40; width <= 120; width += 1) {
        // the longest link that continues on the next line fits the narrowest maximum
        const narrow = { width, maxWidth: width + 20 };
        const fixed = fix(source, narrow);
        const lines = fixed.split('\n');

        for (const link of links) {
          expect(
            lines.filter((line) => line.includes(link)),
            `${link} at ${width}\n${fixed}`,
          ).toHaveLength(1);
        }

        expect(words(fixed), `width ${width}`).toEqual(words(source));
        expect(fix(fixed, narrow), `width ${width}`).toBe(fixed);

        expect(
          issues(fixed, narrow).filter((issue) => !issue.endsWith(':overflow')),
          `width ${width}\n${fixed}`,
        ).toEqual([]);
      }
    });

    it('reports a link that continues on the next line as a verdict, even in lines that are even', () => {
      // these lines are as even as they get when a line may end inside a link, like the third one
      const split = [
        '//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for',
        '//! the main items, or [the provider module][`provider`] for the rest.',
        '//! A [link with a destination](crate::permissions::Permission) and [a link',
        '//! to an anchor](crate::Provider#method.reads) also resolve, and so do',
        '//! [`Vec<T>`] and [HashMap<K, V>].',
        '',
      ].join('\n');

      expect(issues(split, wide)).toEqual(['3:unbalanced']);
      expect(analyze(split, wide).some((comment) => hasVerdictIssues(comment))).toBe(true);
      expect(fix(split, wide)).toBe(rewrapped);
    });

    it('joins a link that continues on the next line in its destination, title, or label', () => {
      const split = [
        '/// See [the docs](crate::docs',
        '/// "The docs") and [the parser][the',
        '/// parser] or [the lexer](',
        '/// crate::lexer) and ![a',
        '/// diagram](diagram.svg) here.',
        'fn a() {}',
        '',
      ].join('\n');

      expect(fix(split, settings)).toBe(
        [
          '/// See [the docs](crate::docs "The docs") and',
          '/// [the parser][the parser] or [the lexer]( crate::lexer)',
          '/// and ![a diagram](diagram.svg) here.',
          'fn a() {}',
          '',
        ].join('\n'),
      );
    });

    it('keeps a paragraph whose link continues on the next line and is too long for one line', () => {
      const split = [
        '/// See [the long text of a link that goes on and on',
        '/// and on](crate::a::very::long::path::to::an::item) for the details.',
        'fn a() {}',
        '',
      ].join('\n');

      expect(summary(split, settings)).toEqual(['1-2 outer-line-doc: prose (unbreakable text across lines)']);
      expect(fix(split, settings)).toBe(split);

      // with room for the link, the rewrap joins it
      expect(fix(split, wide)).toBe(
        [
          '/// See',
          '/// [the long text of a link that goes on and on and on](crate::a::very::long::path::to::an::item)',
          '/// for the details.',
          'fn a() {}',
          '',
        ].join('\n'),
      );
    });

    it('keeps a link that is longer than the maximum in one piece and reports it', () => {
      for (const text of [`\`${'very_long_name_'.repeat(6)}\``, 'the text of a link that is long']) {
        const link = `[${text}](crate::${'module::'.repeat(8)}item)`;
        const long = `/// See ${link} for the details of the thing.\nfn a() {}\n`;
        const fixed = fix(long, settings);

        expect(fixed).toBe(`/// See\n/// ${link}\n/// for the details of the thing.\nfn a() {}\n`);
        expect(issues(fixed, settings)).toEqual(['2:overflow']);
      }
    });
  });

  it('keeps link reference definitions, headings, and their paragraphs as written', () => {
    const source = [
      '/// Returns the [`Config`] of the crate.',
      '///',
      '/// # Errors',
      '///',
      '/// Fails when the file',
      '/// is missing.',
      '///',
      '/// [`Config`]: crate::config::Config',
      '/// [the docs]: https://docs.rs/crate/latest/crate/config/struct.Config.html#method.with_a_long_anchor_name',
      'fn a() {}',
      '',
    ].join('\n');

    expect(summary(source, settings)).toEqual(['1-9 outer-line-doc: prose, prose (markup), prose, prose (markup)']);

    expect(fix(source, settings)).toBe(
      source.replace('/// Fails when the file\n/// is missing.', '/// Fails when the file is missing.'),
    );

    // the colons of link reference definitions are hints, which the agent's rules say to keep
    expect(issues(source, settings)).toEqual([
      '5:underfill',
      '6:widow',
      '8:label-colon',
      '9:overflow',
      '9:label-colon',
    ]);
  });

  it('never touches doctests, including hidden lines, attributes, and lines longer than the width', () => {
    const doctest = [
      '/// ```rust,no_run',
      '/// # use my_crate::Thing;',
      '/// let thing = Thing::new(); // a long line of code that goes past the width of the comment by far',
      '/// ```',
      '///',
      '/// ```ignore',
      '/// not even Rust',
      '/// ```',
      '///',
      '/// ~~~text',
      '/// a fence with tildes',
      '/// ~~~',
      '///',
      '///     let indented = "an indented code block";',
      'fn a() {}',
      '',
    ].join('\n');

    expect(summary(doctest, settings)).toEqual([
      '1-14 outer-line-doc: code (code block), code (code block), code (code block), code (indented)',
    ]);

    expect(issues(doctest, settings)).toEqual([]);
    expect(fix(doctest, settings)).toBe(doctest);
  });

  it('rewraps list items with a hanging indent, and keeps tables', () => {
    const source = [
      '/// Options:',
      '///',
      '/// - `width`: the preferred width of a',
      '///   comment line,',
      '///   including its prefix',
      '/// 1. the first',
      '///    step',
      '///',
      '/// | Option | Meaning |',
      '/// | ------ | ------- |',
      '/// | `width` | the width of a line that is longer than the maximum width of the comment |',
      'fn a() {}',
      '',
    ].join('\n');

    expect(fix(source, settings)).toBe(
      [
        '/// Options:',
        '///',
        '/// - `width`: the preferred width of a comment line,',
        '///   including its prefix',
        '/// 1. the first step',
        '///',
        '/// | Option | Meaning |',
        '/// | ------ | ------- |',
        '/// | `width` | the width of a line that is longer than the maximum width of the comment |',
        'fn a() {}',
        '',
      ].join('\n'),
    );
  });

  it('never starts a line with a word that Markdown reads as the start of a block', () => {
    const source =
      '/// Accepts a list - like this one - or # of items, + more > less, and 1. or 2) as numbers.\nfn a() {}\n';

    for (let width = 12; width <= 60; width += 1) {
      const fixed = fix(source, { width, maxWidth: width });

      expect(fixed, `width ${width}`).not.toMatch(/^\/\/\/ (?:[-+#>]|\d[.)])(?: |$)/m);
      expect(fix(fixed, { width, maxWidth: width }), `width ${width}`).toBe(fixed);
    }
  });

  it('treats lines that start with `@` as prose, since Rust has no JSDoc tags', () => {
    const source = ['/// Returns the value', '/// @param x is not a tag in Rust.', 'fn a() {}', ''].join('\n');

    expect(summary(source)).toEqual(['1-2 outer-line-doc: prose']);
    expect(fix(source)).toBe('/// Returns the value @param x is not a tag in Rust.\nfn a() {}\n');
  });
});

/**
 * Each of these once changed what rustdoc renders for a doc comment of a crate on crates.io,
 * which `native/verify/verify.mjs` found. All but the last also apply to JSDoc comments, which
 * are Markdown too, so they are checked in both languages.
 */
describe('Markdown that a rewrap must never create or join', () => {
  const both = (lines: readonly string[]) => {
    return [
      { file: 'file.ts', source: renderComment({ indent: '', lines }, 'jsdoc'), prefix: String.raw`\s\*` },
      { file: 'lib.rs', source: renderComment({ indent: '', lines }, 'outer-line-doc'), prefix: '///' },
    ];
  };

  const analyzeFile = (file: string, source: string, overrides: Partial<AnalyzeOptions>) => {
    return analyzeSource(source, file, { ...options, ...overrides });
  };

  const fixFile = (file: string, source: string, overrides: Partial<AnalyzeOptions>): string => {
    const lines = source.split('\n');

    for (const comment of analyzeFile(file, source, overrides).toReversed()) {
      lines.splice(
        comment.startLine - 1,
        comment.endLine - comment.startLine + 1,
        ...rewrapComment(comment).split('\n'),
      );
    }

    return lines.join('\n');
  };

  const reasons = (file: string, source: string, overrides: Partial<AnalyzeOptions> = {}) => {
    return analyzeFile(file, source, overrides).flatMap((comment) =>
      comment.paragraphs.map((paragraph) => paragraph.reason ?? paragraph.kind),
    );
  };

  it('never starts a line with a word that starts with `>`, which opens a block quote', () => {
    const comparisons = both([
      'Get next greater float for a positive float. Value must be >= 0.0 and < INFINITY, and >1 is fine too.',
    ]);

    for (const { file, source, prefix } of comparisons) {
      for (let width = 16; width <= 80; width += 1) {
        const fixed = fixFile(file, source, { width, maxWidth: width });

        expect(fixed, `${file} width ${width}`).not.toMatch(new RegExp(`^${prefix} >`, 'm'));
        expect(fixFile(file, fixed, { width, maxWidth: width }), `${file} width ${width}`).toBe(fixed);
      }
    }
  });

  it('keeps a paragraph with a line that starts with `>`, like `>=`, as written', () => {
    const quoted = both(['The implementation requires a JNI version', '>= 1.4 at runtime.']);

    for (const { file, source } of quoted) {
      expect(reasons(file, source), file).toEqual(['markup']);
      expect(fixFile(file, source, {}), file).toBe(source);
    }
  });

  it('keeps an HTML comment as written, and never starts a line with `<!--` or `<?`', () => {
    const htmlComment = both(['<!--', 'The marker above hides the generated documentation.', '-->']);

    for (const { file, source } of htmlComment) {
      expect(reasons(file, source), file).toEqual(['markup']);
      expect(fixFile(file, source, {}), file).toBe(source);
    }

    const htmlStarts = both(['Write <!-- to start a comment and <?xml for a declaration in the file.']);

    for (const { file, source, prefix } of htmlStarts) {
      for (let width = 16; width <= 60; width += 1) {
        expect(fixFile(file, source, { width, maxWidth: width }), `${file} width ${width}`).not.toMatch(
          new RegExp(`^${prefix} <[!?]`, 'm'),
        );
      }
    }
  });

  it('keeps a list item that starts like a link reference definition as written', () => {
    // as one line, it is a link, but a first line of only `[`merge`]: Three-way,` would be a definition
    const listItem = both(['* [`merge`]: Three-way, line-oriented text merging.']);

    for (const { file, source } of listItem) {
      expect(reasons(file, source, { width: 40, maxWidth: 40 }), file).toEqual(['markup']);
      expect(fixFile(file, source, { width: 40, maxWidth: 40 }), file).toBe(source);
    }
  });

  it('never lays out a line of only `=`, `-`, `*`, or `_`, which underlines a heading or is a rule', () => {
    const operators = both(['Assigns x = y -- or x == y, and a ** b, then ___ ends it.']);

    for (const { file, source, prefix } of operators) {
      for (let width = 12; width <= 60; width += 1) {
        const fixed = fixFile(file, source, { width, maxWidth: width });

        expect(fixed, `${file} width ${width}`).not.toMatch(new RegExp(`^${prefix} (?:=+|-+|\\*+|_+)$`, 'm'));
      }
    }

    const underlined = both(['A heading', '=', '', 'Another heading', '--', '', '***']);

    for (const { file, source } of underlined) {
      expect(reasons(file, source), file).toEqual(['markup', 'markup', 'markup']);
    }
  });

  it('opens a code block at a fence without a space after the comment prefix', () => {
    const rust = [
      '//! If you prefer macros, enable the `macros` feature, like:',
      '//!',
      '//!```toml',
      '//! [dependencies]',
      '//! phf = { version = "0.14.0", features = ["macros"] }',
      '//! ```',
      '',
    ].join('\n');

    const jsdoc = rust.replaceAll('//!', ' *').replace(/^/, '/**\n').replace(/\n$/, '\n */\n');

    for (const [file, source] of [
      ['lib.rs', rust],
      ['file.ts', jsdoc],
    ]) {
      expect(reasons(file, source, { width: 30, maxWidth: 30 }), file).toEqual(['prose', 'code block']);

      expect(fixFile(file, source, { width: 30, maxWidth: 30 }).split('\n').slice(-6), file).toEqual(
        source.split('\n').slice(-6),
      );
    }
  });

  it('keeps a Rust paragraph whose code span continues on the next line, since rustdoc shows the spaces in it', () => {
    const lines = [
      'You can invoke your `Fold` implementation like `node.fold_with(&mut',
      'visitor)` where `visitor` is your visitor.',
    ];

    const rust = renderComment({ indent: '', lines }, 'outer-line-doc');
    const jsdoc = renderComment({ indent: '', lines }, 'jsdoc');

    expect(reasons('lib.rs', rust)).toEqual(['code span across lines']);
    expect(fixFile('lib.rs', rust, {})).toBe(rust);

    // jSDoc renderers read the line break in a code span as one space, so JavaScript joins its lines
    expect(fixFile('file.ts', jsdoc, {})).toContain(
      ' * You can invoke your `Fold` implementation like `node.fold_with(&mut visitor)`\n',
    );
  });
});

describe('commented-out Rust code', () => {
  const code = [
    'let x = compute(1, 2);',
    'let mut total: u64 = 0;',
    'x.iter().map(|v| v * 2).collect::<Vec<_>>()',
    'if ready { start(); } else { wait(); }',
    'for item in items {\n    process(item);\n}',
    'match value {\n    Some(x) => x,\n    None => 0,\n}',
    'Some(x) => handle(x),\nNone => {}',
    'use std::collections::HashMap;',
    'pub(crate) use crate::config::Config;',
    '#[derive(Debug, Clone)]\nstruct Point {\n    x: f64,\n    y: f64,\n}',
    'impl Display for Point {\n    fn fmt(&self, f: &mut Formatter<\'_>) -> fmt::Result {\n        write!(f, "({}, {})", self.x, self.y)\n    }\n}',
    'fn len(&self) -> usize;',
    'fn new() -> Self;\nfn is_empty(&self) -> bool { self.len() == 0 }',
    'name: String,\nage: u32,',
    'pub inner: Arc<Mutex<State>>,',
    'timeout: Duration::from_secs(30),',
    'retries: 3',
    'const MAX: usize = 1 << 20;',
    'static NAMES: &[&str] = &["a", "b"];',
    'println!("value: {value:?}");',
    'assert_eq!(parse("1"), Ok(1));',
    'async fn fetch(url: &str) -> Result<Bytes> {\n    reqwest::get(url).await?.bytes().await\n}',
    'type Result<T> = std::result::Result<T, Error>;',
    'unsafe { ptr.read() }',
    'let r: &\'static str = "x";',
    '}\nfn next() {',
  ];

  const prose = [
    'Returns the value.',
    'Done',
    'Default: refuse',
    'See [`Config`] (the thing) for more.',
    'Note: the value is cached.',
    'This is a sentence; it has a semicolon.',
    'Use `let x = 1;` to declare a variable.',
    'Calls `foo(bar)` and returns its result.',
    'The map (from keys to values) is sorted.',
    'If x < y and y > z, the value is unchanged.',
    'Panics if the index is out of bounds.',
    'A = B in this notation, so the sides are equal.',
    '[`count_provider_reads`]',
    '[`permissions`](crate::permissions)',
    'Some(value) when found',
    'returns\ncloses\n(one)',
  ];

  it('tells code from prose with the Rust parser', () => {
    expect(code.filter((text) => !isRustCode(text))).toEqual([]);
    expect(prose.filter((text) => isRustCode(text))).toEqual([]);
  });

  it('keeps code paragraphs as they are in every comment form, and rewraps prose', () => {
    for (const text of code) {
      for (const form of RUST_FORMS) {
        const source = renderComment({ indent: '', lines: ['Example:', '', ...text.split('\n')] }, form);
        const [comment] = analyze(source, { width: 20, maxWidth: 20 });
        const reasons = comment.paragraphs.slice(1).map((paragraph) => paragraph.reason);

        expect(
          reasons.filter((reason) => !/^(?:code|code-like line|indented)$/.test(reason ?? '')),
          `${form}\n${source}`,
        ).toEqual([]);

        expect(
          comment.paragraphs
            .slice(1)
            .every((paragraph) => paragraph.issues.every((issue) => issue.type !== 'underfill')),
          source,
        ).toBe(true);

        expect(rewrapComment(comment), source).toBe(comment.text);
      }
    }
  });
});

describe('legal comments and directives', () => {
  it('keeps copyright notices and license headers as they are', () => {
    const source = [
      '//! Copyright (c) 2024 The Authors. All rights reserved. Licensed under the Apache License, Version 2.0.',
      '//! See the LICENSE file.',
      '',
      '/*',
      ' * @license MIT, which is a long line that would overflow the width of the comment by far',
      ' */',
      '',
    ].join('\n');

    expect(summary(source)).toEqual(['1-2 inner-line-doc: code (legal comment)', '4-6 block: code (legal comment)']);

    expect(issues(source)).toEqual([]);
  });

  it('reads `/*!` and `//!` as inner doc comments, not as legal comments like in JavaScript', () => {
    const source = ['/*!', ' * The docs of the crate,', ' * which are wrapped too early.', ' */', ''].join('\n');

    expect(summary(source)).toEqual(['1-4 inner-block-doc: prose']);
    expect(fix(source)).toBe(['/*!', ' * The docs of the crate, which are wrapped too early.', ' */', ''].join('\n'));
  });

  it('keeps tool directives as they are', () => {
    const source = [
      '/// cspell: ignore rustc rustdoc',
      '/// and a line that is not a directive.',
      'fn a() {}',
      '',
    ].join('\n');

    expect(summary(source)).toEqual(['1-2 outer-line-doc: code (directive)']);
  });
});

describe('codeFingerprint for Rust', () => {
  const source = [
    '/// Adds two',
    '/// numbers.',
    'pub fn add(a: i32, b: i32) -> i32 {',
    '    // a plain comment',
    '    a + b /* inline */',
    '}',
    '',
  ].join('\n');

  const fingerprint = (text: string): string => codeFingerprint(text, 'lib.rs');

  it('ignores rewrapped, reworded, moved, or removed plain comments and reworded doc comments', () => {
    for (const changed of [
      source.replace('/// Adds two\n/// numbers.', '/// Adds two numbers.'),
      source.replace('/// Adds two\n/// numbers.', '/// Returns the sum of two numbers.\n///\n/// # Examples'),
      source.replace('    // a plain comment\n', ''),
      source.replace('    // a plain comment\n', '    /*\n     * A plain comment that is a block now.\n     */\n'),
      source.replace('a + b /* inline */', '/* moved */ a + b'),
      source.replaceAll('\n', '\r\n'),
    ]) {
      expect(fingerprint(changed), changed).toBe(fingerprint(source));
    }
  });

  it('tells apart changes to code, to literals, and to the kind or place of a doc comment', () => {
    for (const changed of [
      source.replace('a + b', 'a - b'),
      source.replace('/// Adds two\n/// numbers.', '// Adds two\n// numbers.'),
      source.replace('/// Adds two\n/// numbers.', '//! Adds two\n//! numbers.'),
      source.replace('/// Adds two\n/// numbers.', '/** Adds two numbers. */'),
      source.replace('/// Adds two\n/// numbers.\n', ''),
      source
        .replace('/// Adds two\n/// numbers.\npub fn add', 'pub fn add')
        .replace('{\n', '{\n    /// Adds two numbers.\n'),
      'const S: &str = "a  b";\n'.replace('a  b', 'a b'),
      'const R: &str = r#"a\nb"#;\n'.replace('\n', ' '),
    ]) {
      expect(fingerprint(changed), changed).not.toBe(fingerprint(source));
    }

    expect(fingerprint('const S: &str = "a  b";\n')).not.toBe(fingerprint('const S: &str = "a b";\n'));
    expect(fingerprint('const R: &str = r#"a\nb"#;\n')).not.toBe(fingerprint('const R: &str = r#"a b"#;\n'));
  });

  it('compares a source with a token that never ends by its whole text', () => {
    expect(fingerprint('fn a() {}\n/* open\n')).not.toBe(fingerprint('fn a() {}\n/* open \n'));
  });
});

describe('Rust rewrap invariants', () => {
  const LAYOUT = new Set(['overflow', 'underfill', 'widow', 'unbalanced', 'wide', 'orphan']);

  // words of Rust docs: intra-doc links, paths, generics, lifetimes, and attributes
  const RUST_WORDS = [
    '[`Foo`]',
    '[`count_provider_reads`],',
    '[`permissions`](crate::permissions)',
    '[the',
    'parser][`Parser`]',
    '[`Vec<T>`].',
    '[HashMap<K,',
    'V>]',
    "`&'a str`",
    'crate::config::Config',
    '[link](https://example.com/a-b)',
    '<https://docs.rs>',
    '`#[derive(Debug)]`',
    '[^note]',
    '**bold**',
    '_under_',
    '~~gone~~',
    '!',
    '=',
    '`/* nested */`',
  ];

  const RUST_STRUCTURES = [
    ['| a | b |', '| - | - |'],
    ['```rust', '# use crate::Foo;', 'let a = Foo::new();', '```'],
    ['```ignore', 'not rust at all, and a long line that never wraps however narrow the comment is', '```'],
    ['┌──┐', '└──┘'],
    ['# Examples'],
    ['[`Foo`]: crate::Foo', '[the docs]: https://docs.rs'],
    ['    let indented = code();'],
  ];

  function layoutIssues(source: string, settings: Partial<AnalyzeOptions>): string[] {
    return analyze(source, settings).flatMap((comment) =>
      comment.paragraphs
        .filter((paragraph) => paragraph.reflowable)
        .flatMap((paragraph) =>
          paragraph.issues.filter((issue) => LAYOUT.has(issue.type)).map((issue) => `${issue.line}:${issue.type}`),
        ),
    );
  }

  function shapeOf(source: string, settings: Partial<AnalyzeOptions>): string[] {
    return analyze(source, settings).flatMap((comment) =>
      comment.paragraphs.map((paragraph) => `${comment.kind} ${paragraph.kind} ${paragraph.reason}`),
    );
  }

  /**
   * Returns the prose paragraphs with a line that ends inside a token, like a link, a code span, or
   * a `{...}` group that continues on the next line. The tokens of such a paragraph differ from the
   * tokens of its lines.
   */
  function splitTokens(source: string, settings: Partial<AnalyzeOptions>) {
    const lines = source.split('\n');

    return analyze(source, settings).flatMap((comment) =>
      comment.paragraphs.filter((paragraph) => {
        const texts = lines.slice(paragraph.startLine - 1, paragraph.endLine).map((line) => textOf(line));
        const perLine = texts.flatMap((text) => tokenize(text));

        return paragraph.reflowable && tokenize(texts.join(' ')).join('\n') !== perLine.join('\n');
      }),
    );
  }

  it('holds for random Rust comments of every form at any width', () => {
    const { random, between, pick, commentBody } = randomComments(65_537, {
      tags: false,
      extra: [...RUST_WORDS, 'thus;', 'f();', '(one)', 'b)', ')', '{', '}', '`'],
      structures: RUST_STRUCTURES,
    });

    let checked = 0;

    for (let run = 0; run < 1500; run += 1) {
      const form = pick(RUST_FORMS);
      const body = commentBody();

      // a `/*` in a block comment opens a nested comment, which is a different comment
      if (!form.endsWith('line-doc') && body.lines.some((line) => line.includes('/*'))) {
        continue;
      }

      const source = `${renderComment(body, form)}${body.indent}fn item() {}\n`;
      const width = between(16, 100);

      const maxWidth = random() < 0.7 ? width + between(0, 40) : undefined;

      // like the CLI, the tolerance never reaches past the maximum
      const settings: Partial<AnalyzeOptions> = {
        width,
        maxWidth,
        tolerance: Math.min(between(0, 2), maxWidth === undefined ? Infinity : maxWidth - width),
        avoidSentenceOrphans: random() < 0.7,
        style: random() < 0.5,
      };

      const fixed = fix(source, settings);
      const context = `${JSON.stringify(settings)}\n${source}\n${fixed}`;

      // a word that is too long for a line on its own stays an overflow
      expect(
        layoutIssues(fixed, settings).filter((issue) => !issue.endsWith(':overflow')),
        context,
      ).toEqual([]);

      expect(fix(fixed, settings), context).toBe(fixed);
      expect(shapeOf(fixed, settings), context).toEqual(shapeOf(source, settings));
      expect(words(fixed), context).toEqual(words(source));
      expect(codeFingerprint(fixed, 'lib.rs'), context).toBe(codeFingerprint(source, 'lib.rs'));

      // a rewrap never ends a line inside a link, and a paragraph that does always has a verdict
      expect(splitTokens(fixed, settings), context).toEqual([]);

      for (const paragraph of splitTokens(source, settings)) {
        expect(
          paragraph.issues.filter((issue) => issue.tier === 'verdict'),
          `line ${paragraph.startLine}\n${context}`,
        ).not.toEqual([]);
      }

      // a rewrap leaves no verdict besides the overflow of a word that is too long for any line
      const verdicts = analyze(fixed, settings)
        .filter((comment) => hasVerdictIssues(comment))
        .flatMap((comment) => comment.paragraphs.filter((paragraph) => paragraph.reflowable))
        .flatMap((paragraph) => paragraph.issues)
        .filter((issue) => issue.tier === 'verdict' && issue.type !== 'overflow');

      expect(verdicts, context).toEqual([]);

      checked += 1;
    }

    expect(checked).toBeGreaterThan(1000);
  }, 180_000);

  /**
   * Each link is in a comment once, so a line holds it as a whole when the line holds its text.
   * That tells a link that continues on the next line apart without the tool's own reading of
   * where a link ends.
   */
  it('joins the links that random line breaks split, in every form and in JSDoc', () => {
    const LINKS = [
      '[the provider module][`provider`]',
      '[a link to an anchor](crate::Provider#method.reads)',
      '[HashMap<K, V>]',
      '[link](https://example.com/a-b "with a title")',
      '[an [inner pair] of brackets](crate::a)',
      '![an image of it](image.png)',
      '[a link, with a comma. And a period](crate::b)',
      '[the lexer][]',
    ];

    const WORDS = ['the', 'request', 'socket', 'closes', 'a', 'of', 'it', 'returns', 'done.', 'first,', '(see', 'it)'];
    const { random, between, pick } = randomComments(15_485_863, { tags: false });

    let joined = 0;
    let kept = 0;

    for (let run = 0; run < 1500; run += 1) {
      const links = LINKS.filter(() => random() < 0.4);
      const parts = Array.from({ length: between(2, 30) }, () => pick(WORDS));

      for (const link of links) {
        parts.splice(between(0, parts.length), 0, link);
      }

      // a break at any space, which includes the spaces inside a link
      const lines = [''];

      for (const word of parts.join(' ').split(' ')) {
        if (lines.at(-1) !== '' && random() < 0.2) {
          lines.push(word);
        } else {
          lines[lines.length - 1] += `${lines.at(-1) ? ' ' : ''}${word}`;
        }
      }

      const form = pick([...RUST_FORMS, 'jsdoc'] as const);
      const file = form === 'jsdoc' ? 'file.ts' : 'lib.rs';
      const source = renderComment({ indent: pick(['', '  ', '\t']), lines }, form);
      const width = between(30, 110);
      const hard = random() < 0.8;

      const settings: AnalyzeOptions = {
        ...options,
        width,
        maxWidth: hard ? width + between(0, 30) : undefined,
        tolerance: hard ? 0 : between(0, 2),
        avoidSentenceOrphans: random() < 0.7,
        style: false,
      };

      const [comment] = analyzeSource(source, file, settings);
      const fixed = rewrapComment(comment);
      const context = `${file} ${JSON.stringify(settings)}\n${source}\n${fixed}`;
      const split = links.filter((link) => !isOnOneLine(source, link));

      expect(comment.paragraphs, context).toHaveLength(1);

      // a paragraph that the tool keeps as written holds a link that is too long to join
      if (!comment.paragraphs[0].reflowable) {
        expect(comment.paragraphs[0].reason, context).toBe('unbreakable text across lines');
        expect(split, context).not.toEqual([]);
        expect(fixed, context).toBe(comment.text);

        kept += 1;

        continue;
      }

      for (const link of links) {
        expect(isOnOneLine(fixed, link), `${link}\n${context}`).toBe(true);
      }

      expect(words(fixed), context).toEqual(words(comment.text));

      if (split.length > 0) {
        expect(hasVerdictIssues(comment), context).toBe(true);
        expect(fixed, context).not.toBe(comment.text);

        joined += 1;
      }

      const [again] = analyzeSource(`${fixed}\n`, file, settings);

      expect(rewrapComment(again), context).toBe(fixed);

      expect(
        again.paragraphs.flatMap((paragraph) => paragraph.issues).filter((issue) => issue.type !== 'overflow'),
        context,
      ).toEqual([]);
    }

    expect(joined).toBeGreaterThan(500);
    expect(kept).toBeGreaterThan(20);
  }, 60_000);
});
