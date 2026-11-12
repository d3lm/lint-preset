import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../cli.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'comments-cli-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

async function capture(argv: readonly string[]) {
  let stdout = '';
  let stderr = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });

  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  const code = await main(argv);

  return { code, stdout, stderr };
}

async function run(command: string, source: string, ...flags: string[]) {
  writeFileSync(path.join(directory, 'a.ts'), source);

  return capture([command, 'a.ts', '--cwd', directory, '--width', '80', ...flags]);
}

const jsdoc = (text: string) => `/**\n * ${text}\n */\nexport const a = 1;\n`;
const hintOnly = jsdoc('Opens the socket; closes it later.');
const overflowing = `Opens the socket and closes it later ${'word '.repeat(20).trim()}.`;
const verdict = jsdoc(overflowing);

describe('check', () => {
  it('accepts a max-width override and caps the single-line allowance', async () => {
    const text = jsdoc('This line is longer than eighty columns but can remain on one line within a larger maximum.');

    const wider = await run('check', text, '--max-width', '120');
    const narrower = await run('check', text, '--max-width', '90');

    expect(wider.code).toBe(0);
    expect(narrower.code).toBe(1);
  });

  it('exits with 0 without diagnostics when a comment only has hints', async () => {
    const { code, stdout, stderr } = await run('check', hintOnly);

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('all comments fit the width');
  });

  it('returns an empty JSON array when only hints remain', async () => {
    const { code, stdout, stderr } = await run('check', hintOnly, '--json');

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(stderr).toBe('');
  });

  it('passes after an agent keeps a hint and the tool fixes the layout', async () => {
    writeFileSync(
      path.join(directory, '.commentsrc.json'),
      JSON.stringify({ agent: { command: [process.execPath, '-e', 'process.stdin.resume()'] } }),
    );

    const source = jsdoc(overflowing.replace(' and ', '; '));
    const agent = await run('agent', source, '--no-interactive');
    const result = readFileSync(path.join(directory, 'a.ts'), 'utf8');
    const check = await run('check', result);
    const list = await run('list', result, '--suspicious');

    expect(agent.code).toBe(0);
    expect(agent.stderr).toContain('rewrapped 1 comment(s)');
    expect(check.code).toBe(0);
    expect(check.stdout).toBe('');
    expect(check.stderr).toContain('all comments fit the width');
    expect(list.stdout).toContain('hints: semicolon');
  });

  it('only prints failing comments when other comments have hints', async () => {
    const { code, stdout, stderr } = await run('check', `${hintOnly}${verdict}`);

    expect(code).toBe(1);
    expect(stdout).toContain('a.ts:5-7 jsdoc, width 80, suspicious: overflow');
    expect(stdout).not.toContain('semicolon');
    expect(stderr).toContain('1 comment(s) with layout issues');
  });

  it('exits with 1 when a comment has an issue that is not a hint', async () => {
    const { code, stdout, stderr } = await run('check', verdict);

    expect(code).toBe(1);
    expect(stdout).toContain('a.ts:1-3 jsdoc, width 80, suspicious: overflow');
    expect(stdout).toContain('<- overflow\n');
    expect(stderr).toContain('1 comment(s) with layout issues');
  });

  it('only checks line comments for lines past the maximum', async () => {
    const pastWidth = await run('check', `// ${'word '.repeat(20).trim()}; and more\nexport const a = 1;\n`);
    const pastMaximum = await run('check', `// ${overflowing.replace(' and ', '; ')}\nexport const a = 1;\n`);

    expect(pastWidth.code).toBe(0);
    expect(pastWidth.stdout).toBe('');
    expect(pastMaximum.code).toBe(1);
    expect(pastMaximum.stdout).toContain('a.ts:1 line, width 80, suspicious: overflow, maximum 120');
    expect(pastMaximum.stdout).not.toContain('semicolon');
  });

  it('exits with 0 when a comment only has hints that used to be verdicts', async () => {
    const sources = [jsdoc('Opens the socket — closes it later.'), jsdoc('----- Handlers -----')];

    for (const source of sources) {
      const { code } = await run('check', source);

      expect(code).toBe(0);
    }
  });

  it('lists hints next to issues on the same comment and line', async () => {
    const source = jsdoc(overflowing.replace(' and ', '; '));
    const { code, stdout } = await run('check', source);

    expect(code).toBe(1);
    expect(stdout).toContain('suspicious: overflow, hints: semicolon');
    expect(stdout).toContain('<- overflow, semicolon (hint)');
  });

  it('exits with 0 when nothing is flagged', async () => {
    const { code, stdout, stderr } = await run('check', jsdoc('Opens the socket.'));

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('all comments fit the width');
  });
});

describe('list', () => {
  it('includes comments with only hints in --suspicious', async () => {
    const { stdout } = await run('list', hintOnly, '--suspicious');

    expect(stdout).toContain('hints: semicolon');
    expect(stdout).toContain(' * Opens the socket; closes it later.  <- semicolon (hint)');
  });

  it('carries the tier of each issue in JSON', async () => {
    const source = jsdoc(overflowing.replace(' and ', '; '));
    const { stdout } = await run('list', source, '--json');
    const [comment] = JSON.parse(stdout) as { paragraphs: { issues: { type: string; tier: string }[] }[] }[];

    expect(comment.paragraphs[0].issues.map((issue) => [issue.type, issue.tier])).toEqual([
      ['overflow', 'verdict'],
      ['semicolon', 'hint'],
    ]);
  });
});

describe('agent', () => {
  it('rejects more than one of the flags that select comments', async () => {
    for (const flags of [
      ['--failing', '--all'],
      ['--suspicious', '--failing'],
    ]) {
      await expect(run('agent', verdict, '--no-interactive', ...flags)).rejects.toThrow(
        'comments: pass only one of --suspicious, --failing, and --all',
      );
    }
  });

  it('accepts failing as the scope in the config file', async () => {
    writeFileSync(
      path.join(directory, '.commentsrc.json'),
      JSON.stringify({ agent: { scope: 'failing', command: [process.execPath, '-e', 'process.stdin.resume()'] } }),
    );

    const { code, stderr } = await run('agent', `${hintOnly}${verdict}`, '--no-interactive');

    expect(code).toBe(0);
    expect(stderr).toContain('for 1 comment(s) in 1 file(s)');
  });
});

describe('--include and --ignore', () => {
  it('replace the include globs of the config file and add to its ignore globs', async () => {
    writeFileSync(
      path.join(directory, '.commentsrc.json'),
      JSON.stringify({ include: ['a.ts', 'b.ts'], ignore: ['c.ts'] }),
    );

    for (const file of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      writeFileSync(path.join(directory, file), verdict);
    }

    const filesListed = async (...flags: string[]) => {
      const { stdout } = await capture(['list', '.', '--cwd', directory, '--json', ...flags]);

      return (JSON.parse(stdout) as { file: string }[]).map((comment) => comment.file);
    };

    expect(await filesListed()).toEqual(['a.ts', 'b.ts']);
    expect(await filesListed('--include', '*.ts')).toEqual(['a.ts', 'b.ts', 'd.ts']);
    expect(await filesListed('--include', 'c.ts', '--include', 'd.ts')).toEqual(['d.ts']);
    expect(await filesListed('--ignore', 'b.ts')).toEqual(['a.ts']);
  });
});

describe('--cwd', () => {
  it('finds the files of a repository that it reaches through a symlink', async () => {
    const repo = path.join(directory, 'repo');
    const link = path.join(directory, 'link');

    mkdirSync(path.join(repo, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
    writeFileSync(path.join(repo, 'src', 'a.ts'), verdict);
    symlinkSync(repo, link);

    for (const target of ['src', 'src/a.ts']) {
      const { code, stdout } = await capture(['check', target, '--cwd', link, '--width', '80']);

      expect(code).toBe(1);
      expect(stdout).toMatch(/^src\/a\.ts:1-3 jsdoc/);
    }
  });
});

describe('hook', () => {
  it('exits with 0 and reports arguments that it cannot use as a message', async () => {
    for (const flags of [['--no-such-flag'], ['--host', 'gemini']]) {
      const { code, stdout, stderr } = await capture(['hook', ...flags]);
      const output = JSON.parse(stdout) as Record<string, string>;

      expect(code).toBe(0);
      expect(Object.keys(output)).toEqual(['systemMessage']);
      expect(output.systemMessage).toMatch(/^comments: /);
      expect(stderr).toMatch(/^comments: /);
    }
  });

  it('answers in the format of the host, even when it cannot use the other arguments', async () => {
    const { code, stdout, stderr } = await capture(['hook', '--host', 'cursor', '--no-such-flag']);

    expect(code).toBe(0);
    expect(stdout).toBe('{}\n');
    expect(stderr).toContain('--no-such-flag');
  });

  it('still prints the help', async () => {
    const { code, stdout } = await capture(['hook', '--help']);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage: comments <command>');
  });
});

describe('a file with a syntax error', () => {
  // the error is on line 5, after a comment that is too long
  const broken = `${verdict}export const = ;\n`;

  it('is named by check and list, which pass without its comments', async () => {
    for (const command of ['check', 'list']) {
      const { code, stdout, stderr } = await run(command, broken);

      expect(code).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toMatch(/^comments: skipped a\.ts because of a syntax error on line 5 \(.+\)$/m);
    }
  });

  it('is named on stderr only, so the JSON output stays valid', async () => {
    const { code, stdout, stderr } = await run('check', broken, '--json');

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(stderr).toContain('skipped a.ts because of a syntax error on line 5');
  });

  it('makes wrap fail, which has no rewrap to print', async () => {
    writeFileSync(path.join(directory, 'a.ts'), broken);

    await expect(main(['wrap', 'a.ts:1', '--cwd', directory])).rejects.toThrow(
      'comments: skipped a.ts because of a syntax error on line 5',
    );
  });

  it('does not count a file that parses again', async () => {
    const { code, stderr } = await run('check', verdict);

    expect(code).toBe(1);
    expect(stderr).not.toContain('skipped');
  });
});
