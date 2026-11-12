import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type AgentRunner = 'claude' | 'codex' | 'cursor';
export type HookMode = 'agent' | 'report' | 'off';
export type AgentScope = 'suspicious' | 'failing' | 'all';

export interface AgentConfig {
  /**
   * Names the agent CLI to spawn. Defaults to the host that triggered the hook, or `claude`
   * when run standalone.
   */
  readonly runner?: AgentRunner;

  /**
   * Names the model passed to the runner. Defaults to `haiku` for Claude Code and to the
   * CLI's default otherwise.
   */
  readonly model?: string;

  /**
   * Lists extra arguments appended to the runner's command line.
   */
  readonly args?: readonly string[];

  /**
   * Sets a fully custom command, e.g. `['my-agent', '--prompt', '{prompt}']`. Without a `{prompt}`
   * placeholder, the prompt is written to stdin. Overrides `runner`, `model`, and `args`.
   */
  readonly command?: readonly string[];

  /**
   * Sets how many seconds to wait for each agent before giving up. Defaults to 300.
   */
  readonly timeout?: number;

  /**
   * Sets the most comments to hand to one agent. More comments are split across several agents.
   * A file's comments always go to the same agent, since parallel agents editing one file would
   * overwrite each other's edits, so a file with more comments than this gets an agent of its
   * own. Defaults to 20.
   */
  readonly batchSize?: number;

  /**
   * Sets the most files to hand to one agent, since an agent editing many files is slower and less
   * careful. More files are split across several agents. Defaults to 10.
   */
  readonly maxFiles?: number;

  /**
   * Caps how many agents run at once. The other agents wait, and each one starts when a running
   * agent finishes. Defaults to 6.
   */
  readonly maxAgents?: number;

  /**
   * Points to a Markdown file with formatting rules, relative to the config file.
   * Replaces the built-in rules.
   */
  readonly rules?: string;

  /**
   * Holds extra instructions appended to the rules.
   */
  readonly instructions?: string;

  /**
   * Selects which comments the agent sees. `suspicious` (default) is a triage, not a full review.
   * It only sends comments with hints, like a possible semicolon or a line that may end with the
   * first word of a sentence, and comments with issues in parts the tool never rewraps, so most
   * runs never call the agent. The tool fixes the layout of prose itself. `failing` sends only
   * the comments with verdicts, the ones that fail `comments check`, and no comment that only has
   * hints. `all` sends every comment in changed lines, so that the agent reviews the wording of
   * each against its rules.
   */
  readonly scope?: AgentScope;
}

export interface HookConfig {
  /**
   * Sets what the stop hook does with comments in changed lines.
   *
   * - `agent` (default): hand them to an agent and report any that still don't fit afterwards.
   * - `report`: only report suspicious comments.
   * - `off`: do nothing.
   */
  readonly mode?: HookMode;
}

export interface CommentsConfig {
  /**
   * Sets the preferred line length for comments, including indentation and the comment
   * prefix. Defaults to prettier's `printWidth`, or 80. In Rust files, it defaults to
   * rustfmt's `comment_width` instead, which is 80 by default too.
   */
  readonly width?: number;

  /**
   * Sets the hard limit for measured prose. Defaults to 120, or `width` when it is larger.
   * Parentheticals may use the space between `width` and this limit to stay together.
   */
  readonly maxWidth?: number;

  /**
   * Sets the maximum length of the line that holds a comment whose whole text is one prose
   * paragraph. Such a comment stays on one line up to this length plus `tolerance`, even past
   * `width`, and is wrapped to `width` beyond it. Defaults to 120, and the line never exceeds
   * `maxWidth`.
   */
  readonly singleLineWidth?: number;

  /**
   * Sets how many columns prose lines may go past `width` when that saves a line in a paragraph of
   * three or more lines. A paragraph that already has the layout for a wider `width`, up to `width`
   * plus this many columns, also passes as it is. It never goes past `maxWidth`. When `maxWidth` is
   * omitted, it also sets a legacy hard limit of `width + tolerance`.
   */
  readonly tolerance?: number;

  /**
   * Keep the first word of a new sentence or parenthetical off the end of a line, e.g.
   * `...the module. This` or `...reflows (the` followed by the rest on the next line.
   * A paragraph of two lines also ends its first line with a sentence when the rest fits
   * on the second line and is no longer than the first, instead of with the start of
   * the next sentence, like `...the module. This one`. Other lines avoid ending with the
   * first two words of a sentence, like `...opens. It allocates`, unless that makes them
   * much less even. Defaults to `true`.
   */
  readonly avoidSentenceOrphans?: boolean;

  /**
   * Looks for possible style issues (semicolons, em-dashes and dashes, `label: explanation` colons,
   * asterisk emphasis, and section banners) and reports them as hints, so that the `suspicious` scope
   * hands those comments to the agent too. It only controls this search, and the agent's rules apply
   * to every comment the agent sees either way. Defaults to `true`.
   */
  readonly style?: boolean;

  /**
   * Lists the file extensions to process. Defaults to JavaScript, TypeScript, and Rust extensions.
   */
  readonly extensions?: readonly string[];

  /**
   * Lists glob patterns, relative to the repository root, of the only files to process.
   * Without patterns, every file with one of the `extensions` is processed. `ignore` still
   * skips files that match both.
   */
  readonly include?: readonly string[];

  /**
   * Lists glob patterns, relative to the repository root, of files to skip.
   */
  readonly ignore?: readonly string[];
  readonly agent?: AgentConfig;
  readonly hook?: HookConfig;
}

export interface LoadedConfig {
  readonly config: CommentsConfig;
  readonly filepath?: string;
}

export const DEFAULT_EXTENSIONS = Object.freeze(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.rs']);

const CONFIG_FILES = [
  'comments.config.ts',
  'comments.config.mts',
  'comments.config.js',
  'comments.config.mjs',
  'comments.config.cjs',
  '.commentsrc',
  '.commentsrc.json',
];

const PACKAGE_JSON_KEY = 'comments';

export function defineConfig(config: CommentsConfig): CommentsConfig {
  return config;
}

function readJson(filepath: string): unknown {
  try {
    return JSON.parse(readFileSync(filepath, 'utf8'));
  } catch (error) {
    throw new Error(`comments: failed to parse ${filepath}: ${(error as Error).message}`, { cause: error });
  }
}

async function readConfigFile(filepath: string): Promise<unknown> {
  if (filepath.endsWith('rc') || filepath.endsWith('.json')) {
    return readJson(filepath);
  }

  const module = (await import(pathToFileURL(filepath).href)) as { default?: unknown };

  return module.default ?? module;
}

function assertType(value: unknown, type: string, key: string, filepath: string): void {
  const actual = Array.isArray(value) ? 'array' : typeof value;

  if (value !== undefined && actual !== type) {
    throw new Error(`comments: \`${key}\` in ${filepath} must be a ${type}, got ${actual}`);
  }
}

function assertStrings(value: unknown, key: string, filepath: string): void {
  if (Array.isArray(value) && !value.every((item) => typeof item === 'string')) {
    throw new Error(`comments: \`${key}\` in ${filepath} must only hold strings`);
  }
}

export function validateConfig(raw: unknown, filepath: string): CommentsConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`comments: ${filepath} must export an object`);
  }

  const config = raw as Record<string, unknown>;

  assertType(config.width, 'number', 'width', filepath);
  assertType(config.maxWidth, 'number', 'maxWidth', filepath);
  assertType(config.singleLineWidth, 'number', 'singleLineWidth', filepath);
  assertType(config.tolerance, 'number', 'tolerance', filepath);
  assertType(config.avoidSentenceOrphans, 'boolean', 'avoidSentenceOrphans', filepath);
  assertType(config.style, 'boolean', 'style', filepath);
  assertType(config.extensions, 'array', 'extensions', filepath);
  assertType(config.include, 'array', 'include', filepath);
  assertType(config.ignore, 'array', 'ignore', filepath);
  assertType(config.agent, 'object', 'agent', filepath);
  assertType(config.hook, 'object', 'hook', filepath);
  assertStrings(config.extensions, 'extensions', filepath);
  assertStrings(config.include, 'include', filepath);
  assertStrings(config.ignore, 'ignore', filepath);

  for (const key of ['width', 'maxWidth', 'singleLineWidth', 'tolerance'] as const) {
    const value = config[key];
    const minimum = key === 'tolerance' ? 0 : 1;

    if (value !== undefined && (!Number.isInteger(value) || (value as number) < minimum)) {
      throw new Error(`comments: \`${key}\` in ${filepath} must be an integer of at least ${minimum}`);
    }
  }

  if (typeof config.width === 'number' && typeof config.maxWidth === 'number' && config.maxWidth < config.width) {
    throw new Error(`comments: \`maxWidth\` in ${filepath} must be at least \`width\``);
  }

  const agent = (config.agent ?? {}) as Record<string, unknown>;

  if (agent.runner !== undefined && !['claude', 'codex', 'cursor'].includes(agent.runner as string)) {
    throw new Error(`comments: \`agent.runner\` in ${filepath} must be one of claude, codex, cursor`);
  }

  assertType(agent.model, 'string', 'agent.model', filepath);
  assertType(agent.args, 'array', 'agent.args', filepath);
  assertType(agent.command, 'array', 'agent.command', filepath);
  assertType(agent.timeout, 'number', 'agent.timeout', filepath);
  assertStrings(agent.args, 'agent.args', filepath);
  assertStrings(agent.command, 'agent.command', filepath);

  // a timeout of zero would stop every agent right away, and `NaN` is a number too
  if (agent.timeout !== undefined && !((agent.timeout as number) > 0)) {
    throw new Error(`comments: \`agent.timeout\` in ${filepath} must be a positive number`);
  }

  for (const key of ['batchSize', 'maxFiles', 'maxAgents'] as const) {
    const value = agent[key];

    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
      throw new Error(`comments: \`agent.${key}\` in ${filepath} must be a positive integer`);
    }
  }

  assertType(agent.rules, 'string', 'agent.rules', filepath);
  assertType(agent.instructions, 'string', 'agent.instructions', filepath);

  if (agent.scope !== undefined && !['suspicious', 'failing', 'all'].includes(agent.scope as string)) {
    throw new Error(`comments: \`agent.scope\` in ${filepath} must be one of suspicious, failing, all`);
  }

  const hook = (config.hook ?? {}) as Record<string, unknown>;

  if (hook.mode !== undefined && !['agent', 'report', 'off'].includes(hook.mode as string)) {
    throw new Error(`comments: \`hook.mode\` in ${filepath} must be one of agent, report, off`);
  }

  return config as CommentsConfig;
}

export async function loadConfig(cwd: string, options: { explicitPath?: string; stopDir?: string } = {}) {
  if (options.explicitPath) {
    const filepath = path.resolve(cwd, options.explicitPath);

    return { config: validateConfig(await readConfigFile(filepath), filepath), filepath } satisfies LoadedConfig;
  }

  let directory = path.resolve(cwd);

  for (;;) {
    for (const name of CONFIG_FILES) {
      const filepath = path.join(directory, name);

      if (existsSync(filepath)) {
        return { config: validateConfig(await readConfigFile(filepath), filepath), filepath } satisfies LoadedConfig;
      }
    }

    const packageJsonPath = path.join(directory, 'package.json');

    if (existsSync(packageJsonPath)) {
      const value = (readJson(packageJsonPath) as Record<string, unknown>)[PACKAGE_JSON_KEY];

      if (value !== undefined) {
        return { config: validateConfig(value, packageJsonPath), filepath: packageJsonPath } satisfies LoadedConfig;
      }
    }

    const parent = path.dirname(directory);

    if (directory === options.stopDir || parent === directory) {
      return { config: {} } satisfies LoadedConfig;
    }

    directory = parent;
  }
}

interface PrettierOptions {
  readonly printWidth?: number;
  readonly tabWidth?: number;
}

interface PrettierModule {
  resolveConfig: (file: string) => Promise<PrettierOptions | null>;
}

const PRETTIER_FILES = ['.prettierrc', '.prettierrc.json', '.prettierrc.json5'];

function readPrettierFile(directory: string, stopDir: string): PrettierOptions | undefined {
  let current = directory;

  for (;;) {
    for (const name of PRETTIER_FILES) {
      const filepath = path.join(current, name);

      if (!existsSync(filepath)) {
        continue;
      }

      const text = readFileSync(filepath, 'utf8');

      // `.prettierrc` may be YAML, so fall back to plain key lookups
      const printWidth = /["']?printWidth["']?\s*:\s*(\d+)/.exec(text)?.[1];
      const tabWidth = /["']?tabWidth["']?\s*:\s*(\d+)/.exec(text)?.[1];

      return {
        printWidth: printWidth === undefined ? undefined : Number(printWidth),
        tabWidth: tabWidth === undefined ? undefined : Number(tabWidth),
      };
    }

    const packageJsonPath = path.join(current, 'package.json');

    if (existsSync(packageJsonPath)) {
      const prettier = (readJson(packageJsonPath) as { prettier?: unknown }).prettier;

      if (prettier && typeof prettier === 'object') {
        return prettier as PrettierOptions;
      }
    }

    const parent = path.dirname(current);

    if (current === stopDir || parent === current) {
      return undefined;
    }

    current = parent;
  }
}

export class PrettierOptionsResolver {
  private _prettier: PrettierModule | null | undefined;
  private readonly _cache = new Map<string, PrettierOptions>();

  constructor(private readonly _root: string) {}

  private async _loadPrettier(): Promise<PrettierModule | null> {
    if (this._prettier !== undefined) {
      return this._prettier;
    }

    try {
      const require = createRequire(path.join(this._root, 'package.json'));
      const resolved = require.resolve('prettier');

      this._prettier = (await import(pathToFileURL(resolved).href)) as PrettierModule;
    } catch {
      this._prettier = null;
    }

    return this._prettier;
  }

  async resolve(file: string): Promise<PrettierOptions> {
    const prettier = await this._loadPrettier();

    /**
     * Prettier resolves per file, since `overrides` can give files in the same
     * directory different widths.
     */
    if (prettier) {
      try {
        const options = await prettier.resolveConfig(file);

        if (options) {
          return options;
        }
      } catch {
        // fall back to reading the config files directly
      }
    }

    const directory = path.dirname(file);
    const cached = this._cache.get(directory);

    if (cached) {
      return cached;
    }

    const options = readPrettierFile(directory, this._root) ?? {};

    this._cache.set(directory, options);

    return options;
  }
}

const RUSTFMT_FILES = ['rustfmt.toml', '.rustfmt.toml'];

// rustfmt indents with four spaces by default
const RUSTFMT_TAB_SPACES = 4;

/**
 * Reads the widths of Rust files from the nearest rustfmt config, like rustfmt does.
 * It maps `comment_width` to `printWidth`, since that is the width rustfmt wraps comments
 * at, and `tab_spaces` to `tabWidth`.
 */
export class RustfmtOptionsResolver {
  private readonly _cache = new Map<string, PrettierOptions>();

  constructor(private readonly _root: string) {}

  private _read(directory: string): PrettierOptions {
    const cached = this._cache.get(directory);

    if (cached) {
      return cached;
    }

    let options: PrettierOptions | undefined;

    for (const name of RUSTFMT_FILES) {
      const filepath = path.join(directory, name);

      if (existsSync(filepath)) {
        const text = readFileSync(filepath, 'utf8');
        const commentWidth = /^\s*comment_width\s*=\s*(\d+)/m.exec(text)?.[1];
        const tabSpaces = /^\s*tab_spaces\s*=\s*(\d+)/m.exec(text)?.[1];

        options = {
          printWidth: commentWidth === undefined ? undefined : Number(commentWidth),
          tabWidth: tabSpaces === undefined ? RUSTFMT_TAB_SPACES : Number(tabSpaces),
        };

        break;
      }
    }

    const parent = path.dirname(directory);

    options ??=
      directory === this._root || parent === directory ? { tabWidth: RUSTFMT_TAB_SPACES } : this._read(parent);

    this._cache.set(directory, options);

    return options;
  }

  resolve(file: string): PrettierOptions {
    return this._read(path.dirname(file));
  }
}
