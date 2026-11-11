import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Maps each file to its changed lines (1-based), or to `all` when every line counts as changed,
 * e.g. for untracked files.
 */
export type ChangedLines = Map<string, Set<number> | 'all'>;

export interface DiffScope {
  readonly staged?: boolean;

  /**
   * Compare the working tree against the merge base with this ref instead of `HEAD`.
   */
  readonly base?: string;
}

function git(cwd: string, args: readonly string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  // both are null when git itself could not be spawned
  const stdout = (result.stdout as string | null) ?? '';
  const stderr = (result.stderr as string | null) ?? '';

  return { ok: result.status === 0, stdout, stderr };
}

function gitOrThrow(cwd: string, args: readonly string[]): string {
  const result = git(cwd, args);

  if (!result.ok) {
    throw new Error(`comments: \`git ${args.join(' ')}\` failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

/**
 * Splits `-z` output, whose paths are never quoted, unlike line output for names with quotes
 * or control characters.
 */
function splitPaths(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

/**
 * Unquotes a path that git wrote as a C-style string, like `"b/say \"hi\".ts"`.
 * `core.quotePath=false` only stops quoting of non-ASCII names, so quotes,
 * backslashes, and control characters still get quoted.
 */
function unquotePath(value: string): string {
  if (!value.startsWith('"')) {
    return value;
  }

  try {
    return JSON.parse(value) as string;
  } catch {
    return value;
  }
}

export function findRepoRoot(cwd: string): string | undefined {
  const result = git(cwd, ['rev-parse', '--show-toplevel']);

  return result.ok ? result.stdout.trim() : undefined;
}

/**
 * A pure deletion marks the lines on both sides of the removed range, since it changes the comment
 * it was part of.
 */
export function parseUnifiedDiff(diff: string): ChangedLines {
  const changed: ChangedLines = new Map();

  let lines: Set<number> | undefined;

  /**
   * Counts lines left in the hunk, since an added line like `++ x` shows up as `+++ x` and looks
   * like a header.
   */
  let oldPending = 0;
  let newPending = 0;

  for (const line of diff.split('\n')) {
    if (oldPending > 0 || newPending > 0) {
      if (line.startsWith('+')) {
        newPending -= 1;
      } else if (line.startsWith('-')) {
        oldPending -= 1;
      } else if (line.startsWith(' ')) {
        oldPending -= 1;
        newPending -= 1;
      }

      continue;
    }

    if (line.startsWith('+++ ')) {
      const target = unquotePath(line.slice(4).replace(/\t$/, ''));

      if (target === '/dev/null') {
        lines = undefined;

        continue;
      }

      const file = target.startsWith('b/') ? target.slice(2) : target;

      lines = new Set();

      changed.set(file, lines);

      continue;
    }

    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (!hunk) {
      continue;
    }

    const start = Number(hunk[2]);
    const count = hunk[3] ? Number(hunk[3]) : 1;

    oldPending = hunk[1] ? Number(hunk[1]) : 1;
    newPending = count;

    if (!lines) {
      continue;
    }

    if (count === 0) {
      lines.add(start);
      lines.add(start + 1);

      continue;
    }

    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
  }

  return changed;
}

function hasHead(root: string): boolean {
  return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok;
}

export function listUntrackedFiles(root: string): string[] {
  return splitPaths(gitOrThrow(root, ['ls-files', '-z', '--others', '--exclude-standard']));
}

export function listFiles(root: string, paths: readonly string[] = []): string[] {
  return splitPaths(gitOrThrow(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths]));
}

const MAX_HASHED_BYTES = 1024 * 1024;

/**
 * Describes a file by its content, so that saving it again without a change doesn't count as an
 * edit. A file that is too large to read for that is described by its size and the time of its
 * last change instead.
 */
function fileState(absolute: string): string {
  try {
    const stats = statSync(absolute);

    if (!stats.isFile()) {
      return 'no file';
    }

    return stats.size > MAX_HASHED_BYTES
      ? `${stats.size} bytes, changed at ${stats.mtimeMs}`
      : createHash('sha1').update(readFileSync(absolute)).digest('hex');
  } catch {
    return 'missing';
  }
}

/**
 * Maps every file that differs from `HEAD` or is untracked to its state. Any edit to the working
 * tree shows up as a difference between two of these snapshots, including an edit that brings a file
 * back to its committed text, since that file is then missing from the later snapshot. Returns
 * `undefined` when git can't list the files.
 */
export function snapshotChanges(root: string): Map<string, string> | undefined {
  try {
    const tracked = hasHead(root)
      ? splitPaths(gitOrThrow(root, ['diff', '-z', '--name-only', '--no-renames', 'HEAD']))
      : splitPaths(gitOrThrow(root, ['ls-files', '-z', '--cached']));

    const files = new Set([...tracked, ...listUntrackedFiles(root)]);

    return new Map([...files].map((file) => [file, fileState(path.join(root, file))]));
  } catch {
    return undefined;
  }
}

/**
 * Uses explicit prefixes, since `diff.noprefix` or `diff.mnemonicPrefix` would
 * otherwise change `+++ b/<file>`.
 */
const DIFF_FLAGS = ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/'];

export function getChangedLines(root: string, scope: DiffScope = {}): ChangedLines {
  if (!hasHead(root)) {
    const files = scope.staged
      ? splitPaths(gitOrThrow(root, ['diff', '-z', '--cached', '--name-only', '--diff-filter=d']))
      : listFiles(root);

    return new Map(files.map((file) => [file, 'all'] as const));
  }

  let args: string[];

  if (scope.staged) {
    args = [...DIFF_FLAGS, '--cached', 'HEAD'];
  } else if (scope.base) {
    const mergeBase = gitOrThrow(root, ['merge-base', scope.base, 'HEAD']).trim();

    args = [...DIFF_FLAGS, mergeBase];
  } else {
    args = [...DIFF_FLAGS, 'HEAD'];
  }

  const changed = parseUnifiedDiff(gitOrThrow(root, args));

  if (!scope.staged) {
    for (const file of listUntrackedFiles(root)) {
      changed.set(file, 'all');
    }
  }

  return changed;
}
