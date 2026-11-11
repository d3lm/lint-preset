import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildInvocation, buildPrompt, CHILD_ENV, DEFAULT_RULES, describeAgent, runAgent } from '../agent.js';
import { analyzeSource } from '../analyze.js';
import { loadConfig, PrettierOptionsResolver, type CommentsConfig } from '../config.js';
import { batchFiles, createLogReporter, describeSummary, runFlow } from '../flow.js';
import { parseUnifiedDiff } from '../git.js';
import { Project } from '../project.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'comments-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
}

function initRepo(files: Record<string, string>): void {
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');

  // the fake agents leave notes for the tests in the repository, which git must not list as changes
  const notes = ['agent.mjs', 'prompt*.txt', 'started-*', 'running', 'overlap'];

  mkdirSync(path.join(directory, '.git', 'info'), { recursive: true });
  writeFileSync(path.join(directory, '.git', 'info', 'exclude'), `${notes.join('\n')}\n`);

  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, file), content);
  }

  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

function createProject(config: CommentsConfig): Project {
  return new Project(directory, config, { isGitRepo: true, cwd: directory });
}

describe('parseUnifiedDiff', () => {
  it('collects added lines and marks both sides of deletions', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+one',
      '+two',
      '@@ -10 +11,0 @@',
      '-gone',
      'diff --git a/old.ts b/old.ts',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual(new Map([['src/a.ts', new Set([4, 5, 11, 12])]]));
  });

  it('unquotes paths that git writes as C-style strings and drops the tab after names with spaces', () => {
    const diff = [
      String.raw`--- "a/src/say \"hi\".ts"`,
      String.raw`+++ "b/src/say \"hi\".ts"`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '--- a/src/with space.ts',
      '+++ b/src/with space.ts\t',
      '@@ -2 +2 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual(
      new Map([
        ['src/say "hi".ts', new Set([1])],
        ['src/with space.ts', new Set([2])],
      ]),
    );
  });

  it('does not mistake added or removed lines that start with `++` or `--` for file headers', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '--- removed',
      '-x',
      '+++ added',
      '+y',
      String.raw`\ No newline at end of file`,
      '@@ -9,0 +10 @@',
      '+z',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual(new Map([['src/a.ts', new Set([1, 2, 10])]]));
  });
});

describe('Project', () => {
  it('uses a 120-column maximum by default and preserves an explicit maximum', async () => {
    writeFileSync(path.join(directory, 'a.ts'), '/**\n * A short paragraph.\n */\n');

    const standard = await createProject({}).analyze({ targets: ['a.ts'] });
    const configured = await createProject({ width: 80, maxWidth: 100 }).analyze({ targets: ['a.ts'] });
    const legacy = await createProject({ width: 80, tolerance: 5 }).analyze({ targets: ['a.ts'] });

    expect(standard[0].comments[0].maxWidth).toBe(120);
    expect(configured[0].comments[0].maxWidth).toBe(100);
    expect(legacy[0].comments[0].maxWidth).toBe(85);
  });

  it('finds changed and untracked files whose names git quotes', async () => {
    const tracked = 'say "hi".ts';
    const untracked = String.raw`back\slash.ts`;

    initRepo({ [tracked]: 'export const a = 1;\n' });
    writeFileSync(path.join(directory, tracked), '/**\n * x\n * y\n */\nexport const a = 1;\n');
    writeFileSync(path.join(directory, untracked), '/**\n * x\n * y\n */\n');

    const analyses = await createProject({}).analyze({});

    expect(analyses.map((analysis) => [analysis.file, analysis.comments.length])).toEqual([
      [untracked, 1],
      [tracked, 1],
    ]);
  });
});

describe('PrettierOptionsResolver', () => {
  it('resolves prettier options per file, so overrides apply to files in the same directory', async () => {
    const prettier = path.join(directory, 'node_modules', 'prettier');

    mkdirSync(prettier, { recursive: true });
    writeFileSync(path.join(prettier, 'package.json'), JSON.stringify({ name: 'prettier', main: 'index.mjs' }));

    writeFileSync(
      path.join(prettier, 'index.mjs'),
      "export async function resolveConfig(file) { return { printWidth: file.endsWith('.ts') ? 120 : 80 }; }\n",
    );

    const resolver = new PrettierOptionsResolver(directory);

    expect(await resolver.resolve(path.join(directory, 'a.js'))).toEqual({ printWidth: 80 });
    expect(await resolver.resolve(path.join(directory, 'b.ts'))).toEqual({ printWidth: 120 });
  });

  it('falls back to reading the config file when prettier is not installed', async () => {
    writeFileSync(path.join(directory, '.prettierrc'), 'printWidth: 100\ntabWidth: 4\n');

    const resolver = new PrettierOptionsResolver(directory);

    expect(await resolver.resolve(path.join(directory, 'a.ts'))).toEqual({ printWidth: 100, tabWidth: 4 });
  });
});

describe('loadConfig', () => {
  it('rejects invalid maximum widths', async () => {
    for (const config of [{ maxWidth: 0 }, { maxWidth: 100.5 }, { width: 100, maxWidth: 80 }]) {
      writeFileSync(path.join(directory, '.commentsrc.json'), JSON.stringify(config));
      await expect(loadConfig(directory, { stopDir: directory })).rejects.toThrow('maxWidth');
    }
  });

  it('finds a JSON rc file in a parent directory', async () => {
    writeFileSync(path.join(directory, '.commentsrc.json'), JSON.stringify({ width: 100 }));

    const nested = path.join(directory, 'nested');

    execFileSync('mkdir', [nested]);

    const loaded = await loadConfig(nested, { stopDir: directory });

    expect(loaded.config).toEqual({ width: 100 });
  });

  it('reads the `comments` key from package.json', async () => {
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ comments: { tolerance: 2 } }));

    const loaded = await loadConfig(directory, { stopDir: directory });

    expect(loaded.config).toEqual({ tolerance: 2 });
  });

  it('loads a TypeScript config file', async () => {
    writeFileSync(
      path.join(directory, 'comments.config.ts'),
      "const config: { width: number; agent: { runner: string } } = { width: 90, agent: { runner: 'codex' } };\nexport default config;\n",
    );

    const loaded = await loadConfig(directory, { stopDir: directory });

    expect(loaded.config).toEqual({ width: 90, agent: { runner: 'codex' } });
  });

  it('rejects invalid values', async () => {
    writeFileSync(path.join(directory, '.commentsrc'), JSON.stringify({ agent: { runner: 'gemini' } }));

    await expect(loadConfig(directory, { stopDir: directory })).rejects.toThrow('agent.runner');
  });

  it('rejects a timeout that is not positive, and lists that hold anything but strings', async () => {
    const invalid: [object, string][] = [
      [{ agent: { timeout: 0 } }, 'agent.timeout'],
      [{ agent: { command: ['agent', 1] } }, 'agent.command'],
      [{ agent: { args: [true] } }, 'agent.args'],
      [{ ignore: [1] }, 'ignore'],
      [{ extensions: [null] }, 'extensions'],
    ];

    for (const [config, key] of invalid) {
      writeFileSync(path.join(directory, '.commentsrc.json'), JSON.stringify(config));
      await expect(loadConfig(directory, { stopDir: directory })).rejects.toThrow(`\`${key}\``);
    }
  });
});

describe('buildInvocation', () => {
  const base = { prompt: 'PROMPT', root: '/repo' };

  it('builds an ephemeral Claude Code invocation that may read and edit files, but has no shell', () => {
    const invocation = buildInvocation({ ...base, agent: {}, runner: 'claude' });
    const allowed = invocation.args.slice(invocation.args.indexOf('--allowedTools') + 1);

    expect(invocation.command).toBe('claude');
    expect(invocation.args).toContain('--no-session-persistence');
    expect(allowed).toEqual(['Read', 'Edit', 'Grep', 'Glob']);
    expect(invocation.args.join(' ')).toContain('--model haiku');
    expect(invocation.stdin).toBe('PROMPT');
  });

  it('names the agent CLI and model for progress messages', () => {
    expect(describeAgent({}, 'claude')).toBe('claude, model haiku');
    expect(describeAgent({}, 'cursor')).toBe('cursor-agent');
    expect(describeAgent({ model: 'gpt-5' }, 'codex')).toBe('codex, model gpt-5');
    expect(describeAgent({ command: ['/usr/local/bin/my-agent', '{prompt}'] }, 'claude')).toBe('my-agent');
  });

  it('builds an ephemeral Codex invocation without hooks', () => {
    const invocation = buildInvocation({ ...base, agent: { model: 'small' }, runner: 'codex' });

    expect(invocation.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', 'features.hooks=false', 'small']));
    expect(invocation.args.at(-1)).toBe('-');
  });

  it('passes the prompt as an argument to cursor-agent', () => {
    const invocation = buildInvocation({ ...base, agent: { args: ['--sandbox', 'enabled'] }, runner: 'cursor' });

    expect(invocation.command).toBe('cursor-agent');
    expect(invocation.args.slice(-3)).toEqual(['--sandbox', 'enabled', 'PROMPT']);
  });

  it('supports custom commands with and without a prompt placeholder', () => {
    expect(buildInvocation({ ...base, agent: { command: ['agent', '--prompt={prompt}'] }, runner: 'claude' })).toEqual({
      command: 'agent',
      args: ['--prompt=PROMPT'],
      stdin: undefined,
    });

    expect(buildInvocation({ ...base, agent: { command: ['agent'] }, runner: 'claude' }).stdin).toBe('PROMPT');
  });

  it('keeps text in the prompt that looks like a replacement pattern', () => {
    const prompt = "Use $& and $$ and '$' and $` here";
    const agent = { command: ['agent', '--prompt={prompt}!'] };

    expect(buildInvocation({ ...base, prompt, agent, runner: 'claude' }).args).toEqual([`--prompt=${prompt}!`]);
  });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

describe('runAgent', () => {
  const started: number[] = [];

  afterEach(() => {
    for (const pid of started.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // the process already exited
      }
    }
  });

  function startedPid(): number {
    const pid = Number(readFileSync(path.join(directory, 'pid'), 'utf8'));

    started.push(pid);

    return pid;
  }

  it('kills an agent that ignores the signal it gets when it times out', async () => {
    const script = [
      "require('node:fs').writeFileSync('pid', String(process.pid));",
      "process.on('SIGTERM', () => {});",
      'setTimeout(() => {}, 30_000);',
    ].join('\n');

    const result = await runAgent({ command: process.execPath, args: ['-e', script] }, { root: directory, timeout: 1 });
    const pid = startedPid();

    expect(result).toEqual({ ok: false, error: 'the agent timed out after 1s', output: '' });

    await vi.waitFor(() => {
      expect(isRunning(pid)).toBe(false);
    });
  });

  it('does not wait for a process that the agent left behind with its pipes open', async () => {
    const script = [
      "const { spawn } = require('node:child_process');",
      "const sleeper = ['-e', 'setTimeout(() => {}, 30_000)'];",
      "const child = spawn(process.execPath, sleeper, { stdio: 'inherit', detached: true });",
      "require('node:fs').writeFileSync('pid', String(child.pid));",
      'child.unref();',
      "console.log('done');",
    ].join('\n');

    const result = await runAgent(
      { command: process.execPath, args: ['-e', script] },
      { root: directory, timeout: 20 },
    );

    expect(isRunning(startedPid())).toBe(true);
    expect(result).toEqual({ ok: true, output: 'done' });
  });

  it('reports an agent that is not installed', async () => {
    const result = await runAgent({ command: 'comments-agent-that-does-not-exist', args: [] }, { root: directory });

    expect(result).toEqual({ ok: false, error: '`comments-agent-that-does-not-exist` is not installed', output: '' });
  });
});

describe('buildPrompt', () => {
  it('includes the rules and each comment with its findings, and leaves line breaks to the tool', () => {
    const comments = analyzeSource('/**\n * aaa\n * bbb\n */\n', 'src/a.ts', {
      width: 80,
      tabWidth: 2,
      tolerance: 0,
      avoidSentenceOrphans: true,
      style: true,
    });

    const prompt = buildPrompt({ rules: '# Rules', root: '/repo', comments });

    expect(prompt).toContain('# Rules');
    expect(prompt).toContain('leave its line breaks to the tool');
    expect(prompt).toContain('if it does, move those words to the start of the next line');
    expect(prompt).toContain('### src/a.ts:1-4 (width 80)');
    expect(prompt).toContain('line 2 ends early');
    expect(prompt).toContain('```ts\n/**\n * aaa\n * bbb\n */\n```');
    expect(prompt).not.toContain('Suggested rewrap');
  });

  it('marks hints as possible issues and tells the agent it may reject them', () => {
    const comments = analyzeSource(
      '/**\n * Opens the socket; closes it — later and then it keeps on going until the line is too long.\n */\n',
      'src/a.ts',
      { width: 80, tabWidth: 2, tolerance: 0, avoidSentenceOrphans: true, style: true },
    );

    const prompt = buildPrompt({ rules: '# Rules', root: '/repo', comments });
    const notes = prompt.split('\n').filter((line) => line.startsWith('- ') && line.includes('line 2 '));

    expect(notes).toEqual([
      '- line 2 is 93 columns, over the width of 80',
      expect.stringMatching(/^- possible: line 2 may join clauses with a semicolon \(leave it if .+\)$/),
      expect.stringMatching(/^- possible: line 2 may use an em-dash to join two thoughts \(leave it if .+\)$/),
    ]);

    expect(prompt).toContain('- Notes marked `possible:` come from heuristics.');
    expect(prompt).toContain("don't change anything for that note");
  });

  it('asks for a manual fix of parts the tool keeps as written, without touching their code', () => {
    const comments = analyzeSource(`/* ${'word '.repeat(20)}*/\n`, 'src/a.ts', {
      width: 60,
      tabWidth: 2,
      tolerance: 0,
      avoidSentenceOrphans: true,
      style: true,
    });

    const prompt = buildPrompt({ rules: '# Rules', root: '/repo', comments });

    expect(prompt).toContain('- line 1 is 105 columns, over the width of 60');
    expect(prompt).toContain('- lines 1-1 are kept as written (single-line block comment)');
    expect(prompt).toContain('Fix those notes by hand');
    expect(prompt).toContain('box drawings, hard line breaks, and other intentional layout in them exactly');
    expect(prompt).toContain('If a note can only be fixed by changing those, leave it');
  });

  it('reviews comments without notes instead of telling the agent to leave them', () => {
    const comments = analyzeSource('/**\n * Fine as it is.\n */\n', 'src/a.ts', {
      width: 80,
      tabWidth: 2,
      tolerance: 0,
      avoidSentenceOrphans: true,
      style: true,
    });

    const prompt = buildPrompt({ rules: '# Rules', root: '/repo', comments });

    expect(prompt).toContain('- no measured issues; review the wording and flow');
    expect(prompt).toContain('Review each comment against the rules');
    expect(prompt).not.toContain('has no other notes as it is');
  });
});

describe('DEFAULT_RULES', () => {
  it('keeps the asterisks of a pattern instead of rewriting it to a bare word', () => {
    expect(DEFAULT_RULES).toContain('keep its asterisks and wrap it in a code span, like `` `*test*` ``');
    expect(DEFAULT_RULES).not.toMatch(/bare word/);
  });

  it('treats punctuation as a preference that yields to code, exact text, and meaning', () => {
    expect(DEFAULT_RULES).toContain('a punctuation character on its own is never a reason to edit prose');
    expect(DEFAULT_RULES).not.toMatch(/^- No (semicolons|em-dashes|explanatory colons)/m);
    expect(DEFAULT_RULES.indexOf('## Priorities')).toBeLessThan(DEFAULT_RULES.indexOf('## Style'));
  });

  it('describes the layout as aims with exceptions and leaves measuring to the tool', () => {
    expect(DEFAULT_RULES).toContain('The width is a preferred target.');
    expect(DEFAULT_RULES).toContain('The maximum is a hard limit for measured prose');
    expect(DEFAULT_RULES).toContain("Don't count columns, and don't apply a stricter limit than the notes show.");
    expect(DEFAULT_RULES).toContain('Exact text and intentional layout win over the width');
    expect(DEFAULT_RULES).not.toMatch(/No line may exceed|leaves at least three words/);
  });
});

function file(name: string, count: number) {
  return { name, comments: Array.from({ length: count }) };
}

function names(batches: readonly (readonly { name: string }[])[]): string[][] {
  return batches.map((batch) => batch.map((entry) => entry.name));
}

describe('batchFiles', () => {
  it('keeps everything in one batch when it fits', () => {
    expect(names(batchFiles([file('a', 3), file('b', 4)], 8))).toEqual([['a', 'b']]);
  });

  it('balances files across batches and keeps their order within a batch', () => {
    const files = [file('a', 2), file('b', 6), file('c', 3), file('d', 5)];

    expect(names(batchFiles(files, 8))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('adds batches when balancing would put more than the batch size into one', () => {
    const files = [file('a', 12), file('b', 12), file('c', 12), file('d', 4)];

    expect(names(batchFiles(files, 20))).toEqual([['a', 'd'], ['b'], ['c']]);
  });

  it('never splits a file, even when it has more comments than a batch holds', () => {
    expect(names(batchFiles([file('a', 20), file('b', 1)], 8))).toEqual([['a'], ['b']]);
  });

  it('puts at most the given number of files into one batch, even when their comments would fit', () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => file(name, 1));
    const batches = batchFiles(files, 20, 2);

    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(names(batches).flat().toSorted()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('puts a file into a fuller batch when the emptier ones have no room for another file', () => {
    const files = [file('a', 9), file('b', 1), file('c', 1), file('d', 1)];

    expect(names(batchFiles(files, 10, 2))).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
  });
});

describe('runFlow', () => {
  const misformatted = '/**\n * Opens it; closes\n * it later.\n */\nexport const a = 1;\n';
  const wellFormatted = '/**\n * Opens it and closes it later.\n */\nexport const a = 1;\n';
  const options = { runner: 'claude' } as const;

  function writeAgent(lines: readonly string[]): string {
    const script = path.join(directory, 'agent.mjs');

    writeFileSync(script, ["import { readFileSync, writeFileSync } from 'node:fs';", ...lines].join('\n'));

    return script;
  }

  it('reports suspicious comments in changed lines without changing files', async () => {
    initRepo({ 'a.ts': misformatted, 'untouched.ts': misformatted });
    writeFileSync(path.join(directory, 'a.ts'), `${misformatted}/**\n * x\n * y\n */\n`);

    const summary = await runFlow(createProject({}), {}, { ...options, mode: 'report', select: 'suspicious' });

    expect(summary.remaining.map((comment) => comment.startLine)).toEqual([6]);
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(`${misformatted}/**\n * x\n * y\n */\n`);
  });

  it('hands suspicious comments to the agent and verifies the result', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);

    const agent = writeAgent([
      `writeFileSync('prompt.txt', readFileSync(0, 'utf8') + '\\n' + process.env.${CHILD_ENV});`,
      `writeFileSync('a.ts', ${JSON.stringify(wellFormatted)});`,
    ]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, codeChanged: [], remaining: [] });
    expect(summary.agentError).toBeUndefined();

    const prompt = readFileSync(path.join(directory, 'prompt.txt'), 'utf8');

    expect(prompt).toContain('leave its line breaks to the tool');
    expect(prompt.trimEnd().endsWith('1')).toBe(true);
  });

  it('rewraps comments with only layout issues itself, without an agent', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), '/**\n * aaa\n * bbb\n */\nexport const a = 1;\n');

    const summary = await runFlow(
      createProject({ agent: { command: ['does-not-exist'] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 0, rewrapped: 1, remaining: [] });
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe('/**\n * aaa bbb\n */\nexport const a = 1;\n');
  });

  it('keeps the line endings of a file with CRLF when it rewraps a comment', async () => {
    writeFileSync(path.join(directory, 'a.ts'), '/**\r\n * aaa\r\n * bbb\r\n */\r\nexport const a = 1;\r\n');

    const summary = await runFlow(
      createProject({}),
      { targets: ['a.ts'] },
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 0, rewrapped: 1, remaining: [] });

    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(
      '/**\r\n * aaa bbb\r\n */\r\nexport const a = 1;\r\n',
    );
  });

  it('leaves a file as it is when none of its comments can be rewrapped', async () => {
    const source = `/* ${'word '.repeat(30)}*/\r\nexport const a = 1;\r\n`;

    writeFileSync(path.join(directory, 'a.ts'), source);

    const agent = writeAgent(["readFileSync(0, 'utf8');"]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      { targets: ['a.ts'] },
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, rewrapped: 0 });
    expect(summary.remaining).toHaveLength(1);
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(source);
  });

  it('keeps the byte order mark of a file when it rewraps the comment on its first line', async () => {
    writeFileSync(path.join(directory, 'a.ts'), '\uFEFF/**\n * aaa\n * bbb\n */\nexport const a = 1;\n');

    const summary = await runFlow(
      createProject({}),
      { targets: ['a.ts'] },
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    const rewrapped = '\uFEFF/**\n * aaa bbb\n */\nexport const a = 1;\n';

    expect(summary).toMatchObject({ sentToAgent: 0, rewrapped: 1, remaining: [] });
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(rewrapped);
  });

  describe('files that no agent was given', () => {
    const other = 'export const b = 1;\n';

    async function run(lines: readonly string[]) {
      const agent = writeAgent(["readFileSync(0, 'utf8');", ...lines]);

      return runFlow(
        createProject({ agent: { command: [process.execPath, agent] } }),
        {},
        { ...options, mode: 'agent', select: 'suspicious' },
      );
    }

    it('reports the ones that changed while the agent ran, without counting them as a failure', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': other });
      writeFileSync(path.join(directory, 'a.ts'), misformatted);

      const summary = await run([
        String.raw`writeFileSync('b.ts', 'export const b = 2;\n');`,
        "writeFileSync('new.ts', '');",
      ]);

      expect(summary).toMatchObject({ sentToAgent: 1, codeChanged: [], changedElsewhere: ['b.ts', 'new.ts'] });

      expect(describeSummary(summary)).toContain(
        '2 file(s) that no agent was given changed during the run: b.ts, new.ts',
      );
    });

    it('does not report the files that the agent was given, or files that only changed before it ran', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': other });
      writeFileSync(path.join(directory, 'a.ts'), misformatted);
      writeFileSync(path.join(directory, 'b.ts'), 'export const b = 2;\n');
      writeFileSync(path.join(directory, 'c.ts'), 'export const c = 3;\n');

      const summary = await run([`writeFileSync('a.ts', ${JSON.stringify(wellFormatted)});`]);

      expect(summary).toMatchObject({ sentToAgent: 1, codeChanged: [], changedElsewhere: [] });
      expect(describeSummary(summary)).toBe('comments: sent 1 comment(s) to the agent');
    });

    it('does not report a file that was saved again without a change', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': other });
      writeFileSync(path.join(directory, 'a.ts'), misformatted);
      writeFileSync(path.join(directory, 'b.ts'), 'export const b = 2;\n');

      const summary = await run(["writeFileSync('b.ts', readFileSync('b.ts', 'utf8'));"]);

      expect(summary.changedElsewhere).toEqual([]);
    });

    it('reports a file that the agent brought back to its committed text', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': other });
      writeFileSync(path.join(directory, 'a.ts'), misformatted);
      writeFileSync(path.join(directory, 'b.ts'), 'export const b = 2;\n');

      const summary = await run([`writeFileSync('b.ts', ${JSON.stringify(other)});`]);

      expect(summary.changedElsewhere).toEqual(['b.ts']);
    });

    it('reports nothing outside of a git repository, where the changed files are unknown', async () => {
      writeFileSync(path.join(directory, 'a.ts'), misformatted);
      writeFileSync(path.join(directory, 'b.ts'), other);

      const edit = String.raw`writeFileSync('b.ts', 'export const b = 2;\n');`;
      const agent = writeAgent(["readFileSync(0, 'utf8');", edit]);
      const config = { agent: { command: [process.execPath, agent] } };
      const project = new Project(directory, config, { isGitRepo: false, cwd: directory });

      const summary = await runFlow(
        project,
        { targets: ['a.ts'] },
        { ...options, mode: 'agent', select: 'suspicious' },
      );

      expect(summary).toMatchObject({ sentToAgent: 1, changedElsewhere: [] });
    });
  });

  describe('files with a syntax error', () => {
    // the error is on line 6, after a comment with a layout issue
    const broken = `${misformatted}export const = ;\n`;

    it('skips the file and names it, instead of reporting only the comments before the error', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });
      writeFileSync(path.join(directory, 'a.ts'), broken);

      const summary = await runFlow(createProject({}), {}, { ...options, mode: 'report', select: 'suspicious' });

      expect(summary.remaining).toEqual([]);
      expect(summary.skipped.map(({ file, syntaxError }) => [file, syntaxError.line])).toEqual([['a.ts', 6]]);
      expect(describeSummary(summary)).toMatch(/^comments: skipped a\.ts because of a syntax error on line 6 \(.+\)$/);
    });

    it('never hands the file to an agent, and never rewraps it', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });
      writeFileSync(path.join(directory, 'a.ts'), broken);

      const summary = await runFlow(
        createProject({ agent: { command: ['does-not-exist'] } }),
        {},
        { ...options, mode: 'agent', select: 'all' },
      );

      expect(summary).toMatchObject({ sentToAgent: 0, rewrapped: 0, remaining: [] });
      expect(summary.skipped).toHaveLength(1);
      expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(broken);
    });

    it('names a file that the agent broke, next to the report that its code changed', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });
      writeFileSync(path.join(directory, 'a.ts'), misformatted);

      const agent = writeAgent(["readFileSync(0, 'utf8');", `writeFileSync('a.ts', ${JSON.stringify(broken)});`]);

      const summary = await runFlow(
        createProject({ agent: { command: [process.execPath, agent] } }),
        {},
        { ...options, mode: 'agent', select: 'suspicious' },
      );

      expect(summary.codeChanged).toEqual(['a.ts']);
      expect(summary.skipped.map(({ file }) => file)).toEqual(['a.ts']);
    });
  });

  it('rewraps a comment that the agent reworded but broke into lines badly', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);

    const reworded = '/**\n * Opens it and\n * closes it later.\n */\nexport const a = 1;\n';
    const agent = writeAgent([`writeFileSync('a.ts', ${JSON.stringify(reworded)});`]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 1, rewrapped: 1, codeChanged: [], remaining: [] });
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toBe(wellFormatted);
  });

  it('reports comments that still do not fit and code the agent changed, without reverting anything', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);

    const agent = writeAgent(["writeFileSync('a.ts', readFileSync('a.ts', 'utf8').replace('= 1', '= 2'));"]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary.codeChanged).toEqual(['a.ts']);
    expect(summary.remaining).toHaveLength(1);
    expect(readFileSync(path.join(directory, 'a.ts'), 'utf8')).toContain('= 2');
  });

  it('does not call the agent when nothing is suspicious', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), wellFormatted);

    const summary = await runFlow(
      createProject({ agent: { command: ['does-not-exist'] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary).toMatchObject({ sentToAgent: 0, remaining: [] });
    expect(summary.agentError).toBeUndefined();
  });

  it('hands every changed comment to the agent when selecting all', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), wellFormatted);

    const agent = writeAgent(["writeFileSync('prompt.txt', readFileSync(0, 'utf8'));"]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      {},
      { ...options, mode: 'agent', select: 'all' },
    );

    expect(summary.sentToAgent).toBe(1);
    expect(readFileSync(path.join(directory, 'prompt.txt'), 'utf8')).toContain('no measured issues');
  });

  it('hands a comment with an issue the tool can never rewrap to the agent, but leaves fixable ones to the tool', async () => {
    const long = `/* ${'word '.repeat(30)}*/\nexport const a = 1;\n`;
    const underfilled = '/**\n * Opens it and closes\n * it later.\n */\nexport const a = 1;\n';

    initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), long);
    writeFileSync(path.join(directory, 'b.ts'), underfilled);

    const agent = writeAgent(["writeFileSync('prompt.txt', readFileSync(0, 'utf8'));"]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent] } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    const prompt = readFileSync(path.join(directory, 'prompt.txt'), 'utf8');

    expect(summary).toMatchObject({ sentToAgent: 1, rewrapped: 1 });
    expect(prompt).toContain('### a.ts:1-1');
    expect(prompt).toContain('kept as written (single-line block comment)');
    expect(prompt).not.toContain('### b.ts');
  });

  it('splits comments across agents that run in parallel, one file per agent', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);
    writeFileSync(path.join(directory, 'b.ts'), misformatted);

    const agent = writeAgent([
      "import { readdirSync } from 'node:fs';",
      "const prompt = readFileSync(0, 'utf8');",
      String.raw`const file = /^### (\w+\.ts):/m.exec(prompt)[1];`,
      "writeFileSync(`started-${file}`, '');",
      "while (readdirSync('.').filter((name) => name.startsWith('started-')).length < 2) {",
      '  await new Promise((resolve) => setTimeout(resolve, 20));',
      '}',
      'writeFileSync(`prompt-${file}.txt`, prompt);',
      `writeFileSync(file, ${JSON.stringify(wellFormatted)});`,
    ]);

    const logs: string[] = [];

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent], batchSize: 1, timeout: 10 } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious', reporter: createLogReporter((message) => logs.push(message)) },
    );

    expect(summary).toMatchObject({ sentToAgent: 2, agents: 2, codeChanged: [], remaining: [] });
    expect(describeSummary(summary)).toBe('comments: sent 2 comment(s) to 2 agents');
    expect(summary.agentError).toBeUndefined();

    expect(logs).toEqual(
      expect.arrayContaining([
        `spawning 2 agents (${path.basename(process.execPath)}) for 2 comment(s) in 2 file(s)`,
        '  agent 1: 1 comment(s) in a.ts',
        '  agent 2: 1 comment(s) in b.ts',
        expect.stringMatching(/^agent \d finished in \d+s \(1 of 2 done\)$/),
        expect.stringMatching(/^agent \d finished in \d+s \(2 of 2 done\)$/),
      ]),
    );

    expect(readFileSync(path.join(directory, 'prompt-a.ts.txt'), 'utf8')).not.toContain('### b.ts');
    expect(readFileSync(path.join(directory, 'prompt-b.ts.txt'), 'utf8')).not.toContain('### a.ts');
  });

  it('queues agents beyond the maximum and starts each one when a running agent finishes', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const a = 1;\n', 'c.ts': 'export const a = 1;\n' });

    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      writeFileSync(path.join(directory, name), misformatted);
    }

    const agent = writeAgent([
      "import { existsSync, rmSync } from 'node:fs';",
      "readFileSync(0, 'utf8');",
      "if (existsSync('running')) writeFileSync('overlap', '');",
      "writeFileSync('running', '');",
      'await new Promise((resolve) => setTimeout(resolve, 100));',
      "rmSync('running');",
    ]);

    const logs: string[] = [];

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent], batchSize: 1, maxAgents: 1 } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious', reporter: createLogReporter((message) => logs.push(message)) },
    );

    expect(summary).toMatchObject({ sentToAgent: 3, agents: 3 });
    expect(summary.agentError).toBeUndefined();
    expect(existsSync(path.join(directory, 'overlap'))).toBe(false);

    expect(logs[0]).toBe(
      `spawning 3 agents (${path.basename(process.execPath)}), 1 at a time, for 3 comment(s) in 3 file(s)`,
    );

    expect(logs.filter((message) => message.endsWith(' started'))).toEqual(['agent 2 started', 'agent 3 started']);
  });

  it('names the agents that failed', async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);
    writeFileSync(path.join(directory, 'b.ts'), misformatted);

    const agent = writeAgent(["if (readFileSync(0, 'utf8').includes('### b.ts')) process.exit(3);"]);

    const summary = await runFlow(
      createProject({ agent: { command: [process.execPath, agent], batchSize: 1 } }),
      {},
      { ...options, mode: 'agent', select: 'suspicious' },
    );

    expect(summary.agentError).toBe('agent 2 of 2: the agent exited with code 3');
  });

  it("returns each agent's reply and only logs the replies of agents that failed, unless verbose", async () => {
    initRepo({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const a = 1;\n' });
    writeFileSync(path.join(directory, 'a.ts'), misformatted);
    writeFileSync(path.join(directory, 'b.ts'), misformatted);

    const agent = writeAgent([
      "const failing = readFileSync(0, 'utf8').includes('### b.ts');",
      "console.log(failing ? 'reply from b' : 'reply from a');",
      'if (failing) process.exit(3);',
    ]);

    const run = async (verbose: boolean) => {
      const logs: string[] = [];

      const summary = await runFlow(
        createProject({ agent: { command: [process.execPath, agent], batchSize: 1 } }),
        {},
        {
          ...options,
          mode: 'agent',
          select: 'suspicious',
          reporter: createLogReporter((message) => logs.push(message), { verbose }),
        },
      );

      return { summary, logs };
    };

    const quiet = await run(false);

    expect(quiet.summary.runs?.map((report) => [report.files, report.ok, report.output])).toEqual([
      [['a.ts'], true, 'reply from a'],
      [['b.ts'], false, 'reply from b'],
    ]);

    expect(quiet.logs).toContain('reply from b');
    expect(quiet.logs).not.toContain('reply from a');

    expect(quiet.logs).toContainEqual(
      expect.stringMatching(/^agent 2 failed after \d+s \(\d of 2 done\): the agent exited with code 3$/),
    );

    const verbose = await run(true);

    expect(verbose.logs).toEqual(expect.arrayContaining(['reply from a', 'reply from b']));
  });

  describe('hints', () => {
    const hintOnly = '/**\n * Opens the socket; closes it later.\n */\nexport const a = 1;\n';

    it('does not report comments that only have hints', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });
      writeFileSync(path.join(directory, 'a.ts'), `${hintOnly}${misformatted}`);

      const summary = await runFlow(createProject({}), {}, { ...options, mode: 'report', select: 'suspicious' });

      expect(summary.remaining.map((comment) => comment.startLine)).toEqual([5]);
    });

    it('sends comments with hints to the agent, but does not count them as remaining when the agent keeps them', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });
      writeFileSync(path.join(directory, 'a.ts'), hintOnly);

      const agent = writeAgent(["writeFileSync('prompt.txt', readFileSync(0, 'utf8'));"]);

      const summary = await runFlow(
        createProject({ agent: { command: [process.execPath, agent] } }),
        {},
        { ...options, mode: 'agent', select: 'suspicious' },
      );

      expect(summary).toMatchObject({ sentToAgent: 1, codeChanged: [], remaining: [] });
      expect(readFileSync(path.join(directory, 'prompt.txt'), 'utf8')).toContain('possible: line 2 may join clauses');
      expect(describeSummary(summary)).toBe('comments: sent 1 comment(s) to the agent');
    });

    it('only names issues, not hints, of the comments that remain', async () => {
      initRepo({ 'a.ts': 'export const a = 1;\n' });

      writeFileSync(
        path.join(directory, 'a.ts'),
        `/**\n * Opens the socket; closes it — later ${'word '.repeat(20).trim()}.\n */\nexport const a = 1;\n`,
      );

      const summary = await runFlow(createProject({}), {}, { ...options, mode: 'report', select: 'suspicious' });

      expect(describeSummary(summary)).toBe('comments: 1 comment(s) still have issues: a.ts:1 (overflow)');
    });
  });
});
