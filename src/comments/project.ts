import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { inspectSource, type CommentReport, type SyntaxFailure } from './analyze.js';
import { DEFAULT_EXTENSIONS, PrettierOptionsResolver, type CommentsConfig } from './config.js';
import { getChangedLines, listFiles, snapshotChanges } from './git.js';

export interface Scope {
  /**
   * Lists files, directories, `file:line`, or `file:start-end` targets.
   * When empty, the git scope below applies.
   */
  readonly targets?: readonly string[];
  readonly base?: string;

  /**
   * Considers every comment in the files of the git scope instead of only those on changed lines.
   */
  readonly wholeFiles?: boolean;

  /**
   * Considers every file in the repository instead of only changed lines.
   */
  readonly repo?: boolean;
}

export interface FileAnalysis {
  /**
   * Holds the path relative to the project root, with forward slashes.
   */
  readonly file: string;
  readonly absolute: string;
  readonly source: string;
  readonly comments: readonly CommentReport[];

  /**
   * Set when the file was skipped because the parser stopped at a syntax error.
   * It has no comments then.
   */
  readonly syntaxError?: SyntaxFailure;
}

type LineFilter = Set<number> | 'all';

const DEFAULT_WIDTH = 80;
const DEFAULT_MAX_WIDTH = 120;
const DEFAULT_SINGLE_LINE_WIDTH = 120;
const DEFAULT_TAB_WIDTH = 2;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

function mergeFilter(existing: LineFilter | undefined, next: LineFilter): LineFilter {
  if (existing === 'all' || next === 'all') {
    return 'all';
  }

  return existing ? new Set([...existing, ...next]) : next;
}

function walkDirectory(directory: string, files: string[] = []): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        walkDirectory(path.join(directory, entry.name), files);
      }
    } else if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function overlaps(comment: CommentReport, filter: LineFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  for (let line = comment.startLine; line <= comment.endLine; line += 1) {
    if (filter.has(line)) {
      return true;
    }
  }

  return false;
}

export class Project {
  private readonly _prettier: PrettierOptionsResolver;
  private readonly _extensions: ReadonlySet<string>;

  constructor(
    readonly root: string,
    readonly config: CommentsConfig,
    private readonly _options: { readonly isGitRepo: boolean; readonly cwd: string; readonly width?: number },
  ) {
    this._prettier = new PrettierOptionsResolver(root);
    this._extensions = new Set(config.extensions ?? DEFAULT_EXTENSIONS);
  }

  relative(absolute: string): string {
    return toPosix(path.relative(this.root, absolute));
  }

  private _isIncluded(absolute: string): boolean {
    if (!this._extensions.has(path.extname(absolute))) {
      return false;
    }

    const relative = this.relative(absolute);

    return !(this.config.ignore ?? []).some((pattern) => path.matchesGlob(relative, pattern));
  }

  private _filesIn(directory: string): string[] {
    if (!this._options.isGitRepo) {
      return walkDirectory(directory);
    }

    return listFiles(this.root, [path.relative(this.root, directory) || '.']).map((file) => path.join(this.root, file));
  }

  collect(scope: Scope): Map<string, LineFilter> {
    const files = new Map<string, LineFilter>();

    const add = (absolute: string, filter: LineFilter): void => {
      if (this._isIncluded(absolute) && existsSync(absolute)) {
        files.set(absolute, mergeFilter(files.get(absolute), filter));
      }
    };

    if (scope.targets && scope.targets.length > 0) {
      for (const target of scope.targets) {
        const range = /^(.+):(\d+)(?:-(\d+))?$/.exec(target);
        const absolute = path.resolve(this._options.cwd, range ? range[1] : target);

        if (!existsSync(absolute)) {
          throw new Error(`comments: ${target} does not exist`);
        }

        if (statSync(absolute).isDirectory()) {
          for (const file of this._filesIn(absolute)) {
            add(file, 'all');
          }

          continue;
        }

        if (!range) {
          add(absolute, 'all');

          continue;
        }

        const start = Number(range[2]);
        const end = range[3] ? Number(range[3]) : start;

        add(absolute, new Set(Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => start + offset)));
      }

      return files;
    }

    if (scope.repo) {
      for (const file of this._filesIn(this.root)) {
        add(file, 'all');
      }

      return files;
    }

    if (!this._options.isGitRepo) {
      throw new Error('comments: not a git repository, so pass files or directories explicitly');
    }

    for (const [file, lines] of getChangedLines(this.root, scope)) {
      add(path.join(this.root, file), scope.wholeFiles ? 'all' : lines);
    }

    return files;
  }

  async analyzeFile(absolute: string, filter: LineFilter = 'all'): Promise<FileAnalysis> {
    const source = readFileSync(absolute, 'utf8');
    const prettier = await this._prettier.resolve(absolute);
    const file = this.relative(absolute);
    const width = this._options.width ?? this.config.width ?? prettier.printWidth ?? DEFAULT_WIDTH;

    const maxWidth =
      this.config.maxWidth ??
      Math.max(width, this.config.tolerance === undefined ? DEFAULT_MAX_WIDTH : width + this.config.tolerance);

    const { comments, syntaxError } = inspectSource(source, file, {
      width,
      maxWidth,
      singleLineWidth: this.config.singleLineWidth ?? DEFAULT_SINGLE_LINE_WIDTH,
      tabWidth: prettier.tabWidth ?? DEFAULT_TAB_WIDTH,
      tolerance: Math.min(this.config.tolerance ?? 0, maxWidth - width),
      avoidSentenceOrphans: this.config.avoidSentenceOrphans ?? true,
      style: this.config.style ?? true,
    });

    return { file, absolute, source, comments: comments.filter((comment) => overlaps(comment, filter)), syntaxError };
  }

  /**
   * Records the state of every file with uncommitted changes, to compare it with a later
   * snapshot. Returns `undefined` outside of a git repository, where only reading every
   * file would show which ones changed.
   */
  snapshot(): ReadonlyMap<string, string> | undefined {
    return this._options.isGitRepo ? snapshotChanges(this.root) : undefined;
  }

  async analyze(scope: Scope): Promise<FileAnalysis[]> {
    const results: FileAnalysis[] = [];

    for (const [absolute, filter] of this.collect(scope)) {
      results.push(await this.analyzeFile(absolute, filter));
    }

    return results.toSorted((a, b) => a.file.localeCompare(b.file));
  }
}
