import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPrompt, DEFAULT_RULES } from '../agent.js';
import { analyzeSource } from '../analyze.js';
import { RustfmtOptionsResolver, type CommentsConfig } from '../config.js';
import { runFlow } from '../flow.js';
import { Project } from '../project.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'comments-rust-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), content);
}

function read(file: string): string {
  return readFileSync(path.join(directory, file), 'utf8');
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
}

function initRepo(files: Record<string, string>): void {
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(path.join(directory, '.git', 'info'), { recursive: true });
  writeFileSync(path.join(directory, '.git', 'info', 'exclude'), 'agent.mjs\n');

  for (const [file, content] of Object.entries(files)) {
    write(file, content);
  }

  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

function createProject(config: CommentsConfig, isGitRepo = true): Project {
  return new Project(directory, config, { isGitRepo, cwd: directory });
}

const misformatted = '/// Opens the socket and\n/// closes it later.\npub fn open() {}\n';
const wellFormatted = '/// Opens the socket and closes it later.\npub fn open() {}\n';

describe('Rust files in a project', () => {
  it('reads `.rs` files by default', async () => {
    write('src/lib.rs', misformatted);
    write('src/a.ts', '/**\n * A\n * b.\n */\n');

    const analyses = await createProject({}, false).analyze({ targets: ['src'] });

    expect(analyses.map((analysis) => [analysis.file, analysis.comments.map((comment) => comment.kind)])).toEqual([
      ['src/a.ts', ['jsdoc']],
      ['src/lib.rs', ['outer-line-doc']],
    ]);
  });

  it('takes the width of Rust files from the nearest rustfmt config, and never from prettier', async () => {
    write('.prettierrc', 'printWidth: 120\ntabWidth: 2\n');
    write('src/lib.rs', misformatted);
    write('src/a.ts', '/**\n * A\n * b.\n */\n');
    write('crates/inner/.rustfmt.toml', '# comment_width = 50\ncomment_width = 60\ntab_spaces = 2\n');
    write('crates/inner/src/lib.rs', misformatted);
    write('crates/other/rustfmt.toml', 'max_width = 120\n');
    write('crates/other/src/lib.rs', misformatted);

    const widths = async (config: CommentsConfig) => {
      const analyses = await createProject(config, false).analyze({ targets: ['.'] });

      return Object.fromEntries(analyses.map((analysis) => [analysis.file, analysis.comments[0]?.width]));
    };

    // rustfmt wraps comments at `comment_width`, which is 80 unless it is set, whatever `max_width` is
    expect(await widths({})).toEqual({
      'crates/inner/src/lib.rs': 60,
      'crates/other/src/lib.rs': 80,
      'src/a.ts': 120,
      'src/lib.rs': 80,
    });

    expect(await widths({ width: 100 })).toEqual({
      'crates/inner/src/lib.rs': 100,
      'crates/other/src/lib.rs': 100,
      'src/a.ts': 100,
      'src/lib.rs': 100,
    });
  });

  it('expands tabs in Rust files to the tab width of rustfmt, which is four columns by default', () => {
    write('a/rustfmt.toml', 'tab_spaces = 8\n');

    const resolver = new RustfmtOptionsResolver(directory);

    expect(resolver.resolve(path.join(directory, 'lib.rs'))).toEqual({ tabWidth: 4 });
    expect(resolver.resolve(path.join(directory, 'a', 'b', 'lib.rs'))).toEqual({ printWidth: undefined, tabWidth: 8 });
  });
});

describe('the agent prompt for Rust comments', () => {
  it('fences Rust comments as Rust and has rules for rustdoc', () => {
    const comments = analyzeSource(misformatted, 'src/lib.rs', {
      width: 80,
      tabWidth: 4,
      tolerance: 0,
      avoidSentenceOrphans: true,
      style: true,
    });

    const prompt = buildPrompt({ rules: DEFAULT_RULES, root: '/repo', comments });

    expect(prompt).toContain('```rust\n/// Opens the socket and\n/// closes it later.\n```');
    expect(prompt).toContain('## Rust doc comments');
    expect(prompt).toContain('Intra-doc links are exact text.');
    expect(prompt).toContain('never turn a doc comment (`///`, `//!`, `/**`, `/*!`) into another kind');
  });
});

describe('the comments flow on Rust files', () => {
  const options = { runner: 'claude' } as const;

  function writeAgent(lines: readonly string[]): string[] {
    write('agent.mjs', ["import { readFileSync, writeFileSync } from 'node:fs';", ...lines].join('\n'));

    return [process.execPath, path.join(directory, 'agent.mjs')];
  }

  it('rewraps doc comments itself, keeping the byte order mark and the CRLF line endings', async () => {
    initRepo({ 'src/lib.rs': 'pub fn open() {}\n' });
    write('src/lib.rs', `\uFEFF${misformatted.replaceAll('\n', '\r\n')}`);

    const summary = await runFlow(
      createProject({ agent: { command: ['does-not-exist'] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 0, rewrapped: 1, remaining: [], codeChanged: [] });
    expect(read('src/lib.rs')).toBe(`\uFEFF${wellFormatted.replaceAll('\n', '\r\n')}`);
  });

  it('reports a doc comment that the agent turned into a plain comment as a code change, and never rewraps it', async () => {
    initRepo({ 'src/lib.rs': 'pub fn open() {}\n' });
    write('src/lib.rs', `/// Opens the socket; and\n/// closes it later.\npub fn open() {}\n`);

    const command = writeAgent([
      "const file = 'src/lib.rs';",
      "writeFileSync(file, readFileSync(file, 'utf8').replaceAll('/// ', '// ').replace('; and', ' and'));",
    ]);

    const summary = await runFlow(
      createProject({ agent: { command } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, codeChanged: ['src/lib.rs'] });
    expect(read('src/lib.rs')).toBe('// Opens the socket and\n// closes it later.\npub fn open() {}\n');
  });

  it('rewraps a doc comment that the agent reworded but broke into lines badly', async () => {
    initRepo({ 'src/lib.rs': 'pub fn open() {}\n' });
    write('src/lib.rs', `/// Opens the socket; and\n/// closes it later.\npub fn open() {}\n`);

    const command = writeAgent([
      "const file = 'src/lib.rs';",
      "writeFileSync(file, readFileSync(file, 'utf8').replace('; and', ' and'));",
    ]);

    const summary = await runFlow(
      createProject({ agent: { command } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, rewrapped: 1, codeChanged: [], remaining: [] });
    expect(read('src/lib.rs')).toBe(wellFormatted);
  });

  it('joins a link that the agent left on two lines', async () => {
    const text =
      'See [`permissions`], [`Provider`], and [`count_provider_reads`] for the main items; or [the provider module][`provider`] for the rest. A [link with a destination](crate::permissions::Permission) and [a link to an anchor](crate::Provider#method.reads) also resolve, and so do [`Vec<T>`] and [HashMap<K, V>].';

    // these lines are as even as they get when a line may end inside a link, like the third one
    const fromAgent = [
      '//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for',
      '//! the main items, or [the provider module][`provider`] for the rest.',
      '//! A [link with a destination](crate::permissions::Permission) and [a link',
      '//! to an anchor](crate::Provider#method.reads) also resolve, and so do',
      '//! [`Vec<T>`] and [HashMap<K, V>].',
      '',
    ].join('\n');

    initRepo({ 'src/lib.rs': '' });
    write('src/lib.rs', `//! ${text}\n`);

    const command = writeAgent([`writeFileSync('src/lib.rs', ${JSON.stringify(fromAgent)});`]);

    const summary = await runFlow(
      createProject({ width: 100, maxWidth: 120, agent: { command } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, rewrapped: 1, codeChanged: [], remaining: [] });

    expect(read('src/lib.rs')).toBe(
      [
        '//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for',
        '//! the main items, or [the provider module][`provider`] for the rest.',
        '//! A [link with a destination](crate::permissions::Permission) and',
        '//! [a link to an anchor](crate::Provider#method.reads) also resolve, and',
        '//! so do [`Vec<T>`] and [HashMap<K, V>].',
        '',
      ].join('\n'),
    );
  });

  it('skips a Rust file with a token that never ends, and names it', async () => {
    initRepo({ 'src/lib.rs': 'pub fn open() {}\n' });
    write('src/lib.rs', `${misformatted}/* never closed\n`);

    const summary = await runFlow(createProject({}), {}, { ...options, mode: 'report', select: 'suspicious' });

    expect(summary.skipped).toEqual([
      { file: 'src/lib.rs', syntaxError: { message: 'unterminated block comment', line: 4 } },
    ]);
  });
});
