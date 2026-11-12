#!/usr/bin/env node
/**
 * Verifies that rewrapping Rust comments never changes code or what rustdoc renders.
 *
 * For each pair of widths, it rewraps the comments of the fixture crate with the `comments` CLI
 * and a no-op agent, so that only the tool's own rewrap runs. It also rewraps the comments of
 * every `.rs` file under each `--corpus` directory with the library. Then it checks that:
 *
 * - the code fingerprint and the words of every comment stay the same
 * - a second rewrap changes nothing
 * - every paragraph keeps its kind, and no prose has a layout verdict left besides a word that is
 *   too long for any line
 * - the fixture still compiles and its doctests pass
 * - rustdoc renders the same docs, links, and text before and after, which `comments-verify`
 *   compares in the JSON output of nightly rustdoc
 * - no link that was on one line continues on the next line, and no link of the fixture continues
 *   on the next line at all when each of them fits on a line, since an editor can't follow such a
 *   link. `comments-verify` finds the links with pulldown-cmark, so the check doesn't rely on what
 *   the tool takes for a link
 *
 * Usage: node native/verify/verify.mjs
 * [--widths 40:60,80:100] [--corpus <dir>]... [--limit <files>]
 *
 * It needs `pnpm run build` first, and a nightly toolchain for the JSON output of rustdoc.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERIFY = import.meta.dirname;
const BOM = '\uFEFF';

const { values } = parseArgs({
  options: {
    widths: { type: 'string', default: '40:60,60:80,80:100,100:120' },
    corpus: { type: 'string', multiple: true, default: [] },
    limit: { type: 'string' },
    out: { type: 'string', default: path.join(ROOT, '.scratch/verify') },
  },
});

const { analyzeSource, codeFingerprint, hasVerdictIssues, rewrapComment, tokenize } = await import(
  pathToFileURL(path.join(ROOT, 'dist/comments.js')).href
);

const native = createRequire(import.meta.url)(
  path.join(
    ROOT,
    'native',
    readdirSync(path.join(ROOT, 'native')).find((name) => /^comments\..+\.node$/.test(name)),
  ),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...options });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }

  return result;
}

function rustFiles(directory, files = []) {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory() && entry.name !== 'target' && !entry.name.startsWith('.')) {
      rustFiles(file, files);
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Keeps one version of each crate in a cargo registry, the last one in version order.
 */
function latestCrates(directory) {
  const byName = new Map();

  const names = readdirSync(directory).toSorted((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const name of names) {
    const crate = /^(.+?)-\d+\.\d+\.\d+/.exec(name)?.[1] ?? name;

    byName.set(crate, path.join(directory, name));
  }

  return [...byName.values()];
}

/**
 * Rewraps every comment of a source like the CLI does, keeping its byte order mark
 * and line endings.
 */
function rewrapSource(source, file, settings) {
  const lines = source.split('\n');

  for (const comment of analyzeSource(source, file, settings).toReversed()) {
    const text = rewrapComment(comment);

    if (text === comment.text) {
      continue;
    }

    const first = lines[comment.startLine - 1];
    const mark = first.startsWith(BOM) ? BOM : '';
    const ending = first.endsWith('\r') ? '\r' : '';
    const replacement = text.split('\n').map((line, index) => `${index === 0 ? mark : ''}${line}${ending}`);

    lines.splice(comment.startLine - 1, comment.endLine - comment.startLine + 1, ...replacement);
  }

  return lines.join('\n');
}

/**
 * Returns the words of every comment, without the comment markers, from rustc's lexer.
 */
function commentWords(source) {
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  const { comments, error } = native.scanRust(text);

  if (error) {
    return undefined;
  }

  return comments.flatMap((comment) => {
    const raw = text.slice(comment.start, comment.end);
    const body = comment.block ? raw.slice(2, -2).replace(/^[*!]/, '') : raw.slice(2).replace(/^[/!]/, '');
    const lines = comment.block ? body.split('\n').map((line) => line.replace(/^\s*\*(?= |$)/, '')) : [body];

    return lines.join(' ').split(/\s+/).filter(Boolean);
  });
}

function shapes(source, file, settings) {
  return analyzeSource(source, file, settings).map((comment) => {
    return `${comment.kind}: ${comment.paragraphs.map((paragraph) => `${paragraph.kind} ${paragraph.reason}`).join(', ')}`;
  });
}

// the text of a comment line without its prefix, indentation, and list marker
function textOf(line, settings) {
  return line
    .replaceAll('\t', ' '.repeat(settings.tabWidth))
    .replace(/\r$/, '')
    .replace(/^\s*(?:\/\/[/!]|\*)\s*(?:(?:[-*+]|\d+[.)])\s+)?/, '');
}

function hasCrlfEndings(text) {
  return text
    .split('\n')
    .slice(0, -1)
    .every((line) => line.endsWith('\r'));
}

/**
 * Checks one rewrap of a source, and returns what is wrong with it.
 */
function checkRewrap(file, before, after, settings, stats, { everyComment = true } = {}) {
  const problems = [];

  if (codeFingerprint(after, file) !== codeFingerprint(before, file)) {
    problems.push('the code changed');
  }

  if (JSON.stringify(commentWords(after)) !== JSON.stringify(commentWords(before))) {
    problems.push('the words of the comments changed');
  }

  // the CLI only rewraps comments with verdicts, so only a rewrap of every comment can be repeated here
  if (everyComment && rewrapSource(after, file, settings) !== after) {
    problems.push('a second rewrap changes the source');
  }

  if (JSON.stringify(shapes(after, file, settings)) !== JSON.stringify(shapes(before, file, settings))) {
    problems.push('the paragraphs changed their kind');
  }

  if (before.startsWith(BOM) !== after.startsWith(BOM)) {
    problems.push('the byte order mark changed');
  }

  if (hasCrlfEndings(before) && !hasCrlfEndings(after)) {
    problems.push('the line endings changed');
  }

  const lines = after.split('\n');
  const sourceLines = before.split('\n');
  const sourceComments = analyzeSource(before, file, settings);

  for (const [index, comment] of analyzeSource(after, file, settings).entries()) {
    stats.comments += 1;

    for (const [position, paragraph] of comment.paragraphs.entries()) {
      if (!paragraph.reflowable) {
        continue;
      }

      stats.paragraphs += 1;

      // the paragraphs keep their kinds, so the source paragraph at the same place is this one before the rewrap
      const source = sourceComments[index]?.paragraphs[position];
      const sourceText = source ? sourceLines.slice(source.startLine - 1, source.endLine) : [];
      const longestBefore = Math.max(0, ...sourceText.map((line) => textOf(line, settings).length));

      for (const issue of paragraph.issues.filter((each) => each.tier === 'verdict')) {
        const text = textOf(lines[issue.line - 1], settings);
        const prefixLength = lines[issue.line - 1].replaceAll('\t', ' '.repeat(settings.tabWidth)).length - text.length;
        const longestWord = Math.max(...tokenize(text).map((token) => token.length));

        // no layout fits the maximum when a single word doesn't fit it, so such a line keeps its overflow
        if (issue.type === 'overflow' && prefixLength + longestWord > settings.maxWidth) {
          stats.unbreakable += 1;
        } else if (issue.type === 'overflow' && text.length <= longestBefore) {
          // like for JSDoc, a rewrap never adds a line that is too long and holds more text than any line did before
          stats.kept += 1;
        } else {
          problems.push(`line ${issue.line} has a ${issue.type} verdict after the rewrap`);
        }
      }
    }
  }

  if (before !== after) {
    stats.changedFiles += 1;
  }

  return problems;
}

/**
 * Groups the doc comments of a source like the docs of one item, as runs of the same style with no
 * empty line between them.
 */
function documentGroups(source) {
  const unmarked = source.startsWith(BOM) ? source.slice(1) : source;
  const text = unmarked.replaceAll('\r', '');
  const { comments, error } = native.scanRust(text);

  if (error) {
    return undefined;
  }

  const groups = [];

  for (const comment of comments.filter((each) => each.doc)) {
    const previous = groups.at(-1)?.at(-1);
    const gap = previous ? text.slice(previous.end, comment.start) : '';

    if (previous && previous.doc === comment.doc && /^[\t ]*\n?[\t ]*$/.test(gap)) {
      groups.at(-1).push(comment);
    } else {
      groups.push([comment]);
    }
  }

  return groups.map((group) => {
    const lineStart = text.lastIndexOf('\n', group[0].start - 1) + 1;
    const indent = text.slice(lineStart, group[0].start);

    return {
      doc: group[0].doc,
      text: `${/^[\t ]*$/.test(indent) ? indent : ''}${text.slice(group[0].start, group.at(-1).end)}`,
    };
  });
}

function syntheticCrate(groups) {
  return groups
    .map(({ doc, text }, index) => {
      return doc === 'outer' ? `${text}\npub fn __item_${index}() {}\n` : `pub mod __item_${index} {\n${text}\n}\n`;
    })
    .join('\n');
}

function writeCrate(directory, name, files) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(path.join(directory, 'src'), { recursive: true });

  writeFileSync(
    path.join(directory, 'Cargo.toml'),
    `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n\n[lib]\npath = "src/lib.rs"\n`,
  );

  for (const [file, text] of Object.entries(files)) {
    writeFileSync(path.join(directory, 'src', file), text);
  }
}

function rustdocJson(directory, crate) {
  const target = path.join(directory, 'target');

  run(
    'cargo',
    ['+nightly', 'rustdoc', '-q', '--lib', '--', '-Z', 'unstable-options', '--output-format', 'json', '-A', 'warnings'],
    {
      cwd: directory,
      env: { ...process.env, CARGO_TARGET_DIR: target },
    },
  );

  return path.join(target, 'doc', `${crate.replaceAll('-', '_')}.json`);
}

function compareRendered(before, after, { linksOnOneLine = false } = {}) {
  const flags = linksOnOneLine ? ['--links-on-one-line'] : [];

  const result = run(path.join(VERIFY, 'target/release/comments-verify'), [before, after, ...flags], {
    allowFailure: true,
  });

  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

const widths = values.widths.split(',').map((pair) => pair.split(':').map(Number));
const failures = [];

mkdirSync(values.out, { recursive: true });

run('cargo', ['build', '--release', '-q'], {
  cwd: VERIFY,
  env: { ...process.env, CARGO_TARGET_DIR: path.join(VERIFY, 'target') },
});

const corpusFiles = values.corpus.flatMap((directory) => {
  const crates = existsSync(path.join(directory, 'Cargo.toml')) ? [directory] : latestCrates(directory);

  return crates.flatMap((crate) => (statSync(crate).isDirectory() ? rustFiles(crate) : []));
});

const files = values.limit ? corpusFiles.slice(0, Number(values.limit)) : corpusFiles;

for (const [width, maxWidth] of widths) {
  const settings = {
    width,
    maxWidth,
    singleLineWidth: maxWidth,
    tabWidth: 4,
    tolerance: 0,
    avoidSentenceOrphans: true,
    style: true,
  };

  const label = `width ${width}, maximum ${maxWidth}`;

  // the fixture crate, rewrapped by the CLI
  {
    const directory = path.join(values.out, `fixture-${width}`);
    const before = path.join(directory, 'before');
    const after = path.join(directory, 'after');

    rmSync(directory, { recursive: true, force: true });

    for (const target of [before, after]) {
      cpSync(path.join(VERIFY, 'fixture'), target, {
        recursive: true,
        filter: (source) => !source.includes(`${path.sep}target`),
      });
    }

    writeFileSync(
      path.join(after, '.commentsrc.json'),
      JSON.stringify({ width, maxWidth, singleLineWidth: maxWidth, agent: { command: ['true'], scope: 'all' } }),
    );

    run('git', ['init', '-q'], { cwd: after });
    run('git', ['add', '-A'], { cwd: after });

    run('git', ['-c', 'user.name=verify', '-c', 'user.email=verify@example.com', 'commit', '-qm', 'before'], {
      cwd: after,
    });

    const agent = () => {
      return run('node', [path.join(ROOT, 'dist/bin/comments.js'), 'agent', '--repo', '--no-interactive'], {
        cwd: after,
        allowFailure: true,
      });
    };

    const cli = agent();

    run('git', ['add', '-A'], { cwd: after });

    run('git', ['-c', 'user.name=verify', '-c', 'user.email=verify@example.com', 'commit', '-qm', 'after'], {
      cwd: after,
    });

    agent();

    if (run('git', ['status', '--porcelain'], { cwd: after }).stdout.trim()) {
      failures.push(`fixture (${label}): running the CLI a second time changes files`);
    }

    const stats = { comments: 0, paragraphs: 0, unbreakable: 0, kept: 0, changedFiles: 0 };

    const sources = rustFiles(path.join(before, 'src'));

    for (const file of sources) {
      const relative = path.relative(before, file);
      const source = readFileSync(file, 'utf8');
      const byCli = readFileSync(path.join(after, relative), 'utf8');
      const byLibrary = rewrapSource(source, relative, settings);

      const problems = [
        ...checkRewrap(relative, source, byCli, settings, stats, { everyComment: false }),
        ...checkRewrap(relative, source, byLibrary, settings, { ...stats }).map(
          (problem) => `${problem} (every comment)`,
        ),
      ];

      failures.push(...problems.map((problem) => `fixture (${label}) ${relative}: ${problem}`));
    }

    const env = { ...process.env, CARGO_TARGET_DIR: path.join(directory, 'target') };
    const check = run('cargo', ['check', '-q'], { cwd: after, env, allowFailure: true });
    const doctests = run('cargo', ['test', '-q', '--doc'], { cwd: after, env, allowFailure: true });

    /**
     * The tool joins every link of the fixture that continues on the next line, so none may be left
     * on two lines. A link that is too long for one line stays as it is, and so does its paragraph.
     * That only happens at a maximum that is narrower than the default widths.
     */
    const linksFit = sources.every((file) => {
      const relative = path.relative(before, file);
      const comments = analyzeSource(readFileSync(path.join(after, relative), 'utf8'), relative, settings);

      return comments.every((comment) => {
        return comment.paragraphs.every((paragraph) => paragraph.reason !== 'unbreakable text across lines');
      });
    });

    const rendered = compareRendered(rustdocJson(before, 'comments-fixture'), rustdocJson(after, 'comments-fixture'), {
      linksOnOneLine: linksFit,
    });

    if (check.status !== 0) {
      failures.push(`fixture (${label}): cargo check failed\n${check.stderr}`);
    }

    if (doctests.status !== 0) {
      failures.push(`fixture (${label}): the doctests failed\n${doctests.stdout}${doctests.stderr}`);
    }

    if (!rendered.ok) {
      failures.push(`fixture (${label}): rustdoc renders differently, or a link is split\n${rendered.output}`);
    }

    const summary = cli.stdout.trim().split('\n').at(-1) || cli.stderr.trim().split('\n').at(-1);

    console.log(
      `fixture, ${label}: CLI "${summary}", ${stats.changedFiles} files rewrapped, ${stats.comments} comments, ${stats.paragraphs} prose paragraphs, ${stats.unbreakable} lines held by one long word, ${stats.kept} long lines kept as they were, cargo check ${check.status === 0 ? 'ok' : 'FAILED'}, doctests ${doctests.status === 0 ? 'ok' : 'FAILED'}\n  rustdoc: ${rendered.output.split('\n').at(-1)}`,
    );
  }

  // the corpus, rewrapped by the library
  if (files.length > 0) {
    const stats = { comments: 0, paragraphs: 0, unbreakable: 0, kept: 0, changedFiles: 0 };
    const before = [];
    const after = [];

    let skipped = 0;

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const groups = documentGroups(source);

      if (!groups) {
        skipped += 1;

        continue;
      }

      const rewrapped = rewrapSource(source, file, settings);
      const problems = checkRewrap(file, source, rewrapped, settings, stats);
      const rewrappedGroups = documentGroups(rewrapped);

      if (rewrappedGroups?.length !== groups.length) {
        problems.push('the doc comments changed how they group');
      } else {
        before.push(...groups);
        after.push(...rewrappedGroups);
      }

      failures.push(...problems.map((problem) => `${file} (${label}): ${problem}`));
    }

    const directory = path.join(values.out, `corpus-${width}`);

    writeCrate(path.join(directory, 'before'), 'corpus', { 'lib.rs': syntheticCrate(before) });
    writeCrate(path.join(directory, 'after'), 'corpus', { 'lib.rs': syntheticCrate(after) });

    const rendered = compareRendered(
      rustdocJson(path.join(directory, 'before'), 'corpus'),
      rustdocJson(path.join(directory, 'after'), 'corpus'),
    );

    if (!rendered.ok) {
      failures.push(`corpus (${label}): rustdoc renders differently, or a link is split\n${rendered.output}`);
    }

    console.log(
      `corpus, ${label}: ${files.length - skipped} files (${skipped} with a token that never ends), ${stats.changedFiles} rewrapped, ${stats.comments} comments, ${stats.paragraphs} prose paragraphs, ${stats.unbreakable} lines held by one long word, ${stats.kept} long lines kept as they were\n  rustdoc: ${rendered.output.split('\n').at(-1)}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.slice(0, 50).join('\n\n')}`);
  process.exit(1);
}

console.log('\nall checks passed');
