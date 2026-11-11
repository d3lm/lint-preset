import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CHILD_ENV } from './agent.js';
import {
  hasVerdictIssues,
  isSuspicious,
  rewrapComment,
  type CommentReport,
  type IssueReport,
  type IssueTier,
} from './analyze.js';
import { loadConfig, type AgentRunner, type AgentScope, type CommentsConfig, type HookMode } from './config.js';
import {
  createLogReporter,
  describeSkipped,
  describeSummary,
  runFlow,
  skippedFiles,
  type FlowOptions,
  type FlowSummary,
} from './flow.js';
import { findRepoRoot } from './git.js';
import { Project, type FileAnalysis, type Scope } from './project.js';
import { isLiveTerminal, TerminalUI } from './terminal.js';

const HELP = `
Usage: comments <command> [targets...] [options]

Finds comments in JavaScript and TypeScript files and measures how their prose fits the configured width.
Only agent and hook change files, by applying the exact rewrap to comments that still have layout issues.

Commands:
  list     Print comments in scope with their line lengths, issues, and rewrap suggestions
  check    Print comments with layout violations and exit with code 1 if any remain
  wrap     Print the exact rewrap of the comment at each file:line target
  agent    Hand comments in scope to an agent, then report any that still have issues
  hook     Stop-hook entry point for agents (reads the hook payload from stdin)

Targets are files, directories, file:line, or file:start-end. Without targets, only comments
overlapping uncommitted changes (and untracked files) are considered.

Options:
  --base <ref>      Consider changes since the merge base with <ref>
  --whole-files     Consider every comment in the changed files, not only comments on changed lines
  --repo            Consider every file in the repository
  --suspicious      Only comments with layout issues (overflow, early line ends, last lines of one or two words)
                    or hints (possible orphans, em-dashes, banners, ...). For agent and hook (the default), only
                    comments with hints or with issues in parts the tool never rewraps, a triage, not a full review
  --all             agent, hook: hand every comment in scope to the agent for a full review of its wording
  --verbose         agent, hook: print every agent's reply (otherwise a terminal offers to open them)
  --no-interactive  agent: show the agents while they run, then exit without offering to open their replies
  --json            Print JSON
  --config <path>   Use this config file instead of searching for one
  --cwd <dir>       Run as if started in <dir> (targets and --config resolve against it)
  --host <host>     hook: the agent running the hook (cursor, claude, codex)
  --runner <name>   agent, hook: the agent CLI to spawn (claude, codex, cursor)
  --mode <mode>     hook: agent, report, or off
  -h, --help        Show this help

Config overrides (take precedence over the config file):
  --width <n>             Preferred comment line length
  --max-width <n>         Hard limit for prose (default: 120, never below width)
  --single-line-width <n> Longest line a one-paragraph comment may stay on (default: 120)
  --tolerance <n>         Columns prose may go past width to save a line, within max-width (default: 0)
  --[no-]orphans          Keep a sentence's first word off the end of a line, and end the first of two lines
                          with a sentence when the second is no longer than the first (default: on)
  --[no-]style            Look for possible semicolons, em-dashes, dashes, label colons, emphasis, and banners
                          as hints (default: on). The agent's rules apply either way
  --ignore <glob>         Skip matching files, repeatable
  --model <name>          agent, hook: model for the agent
  --timeout <seconds>     agent, hook: how long to wait for each agent (default: 300)
  --batch-size <n>        agent, hook: most comments per agent (default: 20)
  --max-files <n>         agent, hook: most files per agent (default: 10)
  --max-agents <n>        agent, hook: most agents running at once (default: 6)
  --instructions <text>   agent, hook: extra instructions appended to the rules
`.trim();

const RUNNERS = new Set<string>(['claude', 'codex', 'cursor']);
const MODES = new Set<string>(['agent', 'report', 'off']);

const OPTIONS = {
  tolerance: { type: 'string' },
  orphans: { type: 'boolean' },
  style: { type: 'boolean' },
  ignore: { type: 'string', multiple: true },
  model: { type: 'string' },
  timeout: { type: 'string' },
  'batch-size': { type: 'string' },
  'max-files': { type: 'string' },
  'max-agents': { type: 'string' },
  instructions: { type: 'string' },
  base: { type: 'string' },
  'whole-files': { type: 'boolean' },
  repo: { type: 'boolean' },
  suspicious: { type: 'boolean' },
  all: { type: 'boolean' },
  verbose: { type: 'boolean' },
  interactive: { type: 'boolean' },
  json: { type: 'boolean' },
  width: { type: 'string' },
  'max-width': { type: 'string' },
  'single-line-width': { type: 'string' },
  config: { type: 'string' },
  cwd: { type: 'string' },
  host: { type: 'string' },
  runner: { type: 'string' },
  mode: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

function parse(argv: readonly string[]) {
  return parseArgs({ args: [...argv], allowPositionals: true, allowNegative: true, options: OPTIONS });
}

type Values = ReturnType<typeof parse>['values'];

/**
 * Reads the command, the host, and the help flag without failing on arguments that `parse` rejects,
 * so that the hook can report them in the format of its host.
 */
function peek(argv: readonly string[]): { command?: string; host?: string; help: boolean } {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: OPTIONS,
    strict: false,
  });

  return {
    command: positionals.at(0),
    host: typeof values.host === 'string' ? values.host : undefined,
    help: values.help === true,
  };
}

export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Returns the directory without symlinks, like `process.cwd()` and the repository root that git
 * reports. A path through a symlink would otherwise seem to lie outside of the repository.
 */
function resolveCwd(directory: string, source = '--cwd'): string {
  const resolved = path.resolve(directory);

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`comments: ${source} ${directory} is not a directory`);
  }

  return realpathSync(resolved);
}

function parseInteger(name: string, value: string | undefined, minimum: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`comments: --${name} must be an integer of at least ${minimum}, got ${value}`);
  }

  return number;
}

function defined<T extends object>(object: T): Partial<T> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function applyOverrides(config: CommentsConfig, values: Values): CommentsConfig {
  const overrides = defined({
    width: parseInteger('width', values.width, 1),
    maxWidth: parseInteger('max-width', values['max-width'], 1),
    singleLineWidth: parseInteger('single-line-width', values['single-line-width'], 1),
    tolerance: parseInteger('tolerance', values.tolerance, 0),
    avoidSentenceOrphans: values.orphans,
    style: values.style,
    ignore: values.ignore ? [...(config.ignore ?? []), ...values.ignore] : undefined,
  });

  const agent = defined({
    model: values.model,
    timeout: parseInteger('timeout', values.timeout, 1),
    batchSize: parseInteger('batch-size', values['batch-size'], 1),
    maxFiles: parseInteger('max-files', values['max-files'], 1),
    maxAgents: parseInteger('max-agents', values['max-agents'], 1),
    instructions: values.instructions,
  });

  return { ...config, ...overrides, agent: { ...config.agent, ...agent } };
}

async function createProject(cwd: string, values: Values) {
  const repoRoot = findRepoRoot(cwd);
  const root = repoRoot ?? cwd;
  const loaded = await loadConfig(cwd, { explicitPath: values.config, stopDir: root });
  const config = applyOverrides(loaded.config, values);
  const project = new Project(root, config, { isGitRepo: repoRoot !== undefined, cwd });

  return { project, configPath: loaded.filepath };
}

function scopeFrom(positionals: readonly string[], values: Values): Scope {
  return { targets: positionals, base: values.base, wholeFiles: values['whole-files'], repo: values.repo };
}

function selectFrom(values: Values, project: Project): AgentScope {
  if (values.all) {
    return 'all';
  }

  return values.suspicious ? 'suspicious' : (project.config.agent?.scope ?? 'suspicious');
}

function formatIssue(issue: IssueReport): string {
  return issue.tier === 'hint' ? `${issue.type} (hint)` : issue.type;
}

function formatComment(comment: CommentReport): string {
  const issueList = comment.paragraphs.flatMap((paragraph) => paragraph.issues);
  const issues = new Map<number, string[]>();

  for (const issue of issueList) {
    issues.set(issue.line, [...(issues.get(issue.line) ?? []), formatIssue(issue)]);
  }

  const typesOf = (tier: IssueTier): string[] => {
    return [...new Set(issueList.filter((issue) => issue.tier === tier).map((issue) => issue.type))];
  };

  const verdicts = typesOf('verdict');
  const hints = typesOf('hint');

  const labels = [
    ...(verdicts.length > 0 ? [`suspicious: ${verdicts.join(', ')}`] : []),
    ...(hints.length > 0 ? [`hints: ${hints.join(', ')}`] : []),
  ];

  const status = labels.length > 0 ? labels.join(', ') : 'ok';
  const range = `${comment.startLine}-${comment.endLine}`;
  const location = comment.startLine === comment.endLine ? comment.startLine : range;
  const maximum = comment.maxWidth === undefined ? '' : `, maximum ${comment.maxWidth}`;
  const output = [`${comment.file}:${location} ${comment.kind}, width ${comment.width}, ${status}${maximum}`];
  const lines = comment.text.split('\n');
  const numberWidth = String(comment.endLine).length;

  for (const [offset, text] of lines.entries()) {
    const line = comment.startLine + offset;
    const marks = issues.get(line);
    const length = String(comment.lengths[offset]).padStart(3);

    output.push(
      `  ${String(line).padStart(numberWidth)} ${length} | ${text}${marks ? `  <- ${marks.join(', ')}` : ''}`,
    );
  }

  return output.join('\n');
}

function printComments(comments: readonly CommentReport[], values: Values): void {
  if (values.json) {
    process.stdout.write(`${JSON.stringify(comments, null, 2)}\n`);
    return;
  }

  for (const comment of comments) {
    process.stdout.write(`${formatComment(comment)}\n\n`);
  }
}

function commentsOf(analyses: readonly FileAnalysis[]): CommentReport[] {
  return analyses.flatMap((analysis) => analysis.comments);
}

/**
 * An empty result from the default scope is easy to mistake for a bug.
 */
function hintEmptyScope(analyses: readonly FileAnalysis[], scope: Scope): void {
  const isDefaultScope = (scope.targets ?? []).length === 0 && !scope.repo && !scope.base;

  if (analyses.length === 0 && isDefaultScope) {
    log(
      'comments: no uncommitted changes in JavaScript or TypeScript files. Pass --repo, --base <ref>, or files to widen the scope.',
    );
  }
}

/**
 * A file without any output looks like a file whose comments are fine, so a skipped file is named.
 */
function warnSkipped(analyses: readonly FileAnalysis[]): void {
  for (const skipped of skippedFiles(analyses)) {
    log(`comments: ${describeSkipped(skipped)}`);
  }
}

function parseRunner(value: string | undefined): AgentRunner | undefined {
  if (value !== undefined && !RUNNERS.has(value)) {
    throw new Error(`comments: unknown runner ${value}, expected claude, codex, or cursor`);
  }

  return value as AgentRunner | undefined;
}

async function runWrap(project: Project, targets: readonly string[], values: Values): Promise<number> {
  if (targets.length === 0 || targets.some((target) => !/:\d+(?:-\d+)?$/.test(target))) {
    throw new Error('comments: wrap expects file:line targets, e.g. `comments wrap src/a.ts:12`');
  }

  const results: { file: string; startLine: number; endLine: number; text: string }[] = [];

  for (const target of targets) {
    const analyses = await project.analyze({ targets: [target] });
    const comments = commentsOf(analyses);
    const skipped = skippedFiles(analyses).at(0);

    if (skipped) {
      throw new Error(`comments: ${describeSkipped(skipped)}`);
    }

    if (comments.length === 0) {
      throw new Error(`comments: no comment at ${target}`);
    }

    for (const comment of comments) {
      results.push({
        file: comment.file,
        startLine: comment.startLine,
        endLine: comment.endLine,
        text: rewrapComment(comment),
      });
    }
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    process.stdout.write(`${results.map((result) => result.text).join('\n\n')}\n`);
  }

  return 0;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

interface HookPayload {
  readonly cwd?: string;
  readonly workspace_roots?: readonly string[];
  readonly status?: string;
}

function hookOutput(host: string, message: string | undefined): string {
  // cursor's stop hook has no field for user-facing messages, so the summary only goes to stderr
  if (host === 'cursor' || !message) {
    return '{}';
  }

  return JSON.stringify({ systemMessage: message });
}

function parsePayload(raw: string): HookPayload {
  const payload: unknown = raw.trim() ? JSON.parse(raw) : {};

  return payload !== null && typeof payload === 'object' ? payload : {};
}

function payloadDirectory(payload: HookPayload): string | undefined {
  const roots: unknown = payload.workspace_roots;
  const candidates: unknown[] = [Array.isArray(roots) ? roots.at(0) : undefined, payload.cwd];

  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
}

/**
 * Never throws, not even for arguments it can't parse. Hosts read a failing stop hook as a reason
 * to keep the agent going, so every error becomes a message instead.
 */
async function runHook(argv: readonly string[]): Promise<void> {
  const host = peek(argv).host ?? 'claude';

  let message: string | undefined;

  try {
    const { values, positionals } = parse(argv);

    if (!RUNNERS.has(host)) {
      throw new Error(`comments: unknown host ${host}, expected cursor, claude, or codex`);
    }

    const payload = parsePayload(await readStdin());

    if (process.env[CHILD_ENV] || (payload.status !== undefined && payload.status !== 'completed')) {
      return;
    }

    const directory = values.cwd ?? payloadDirectory(payload);
    const source = values.cwd === undefined ? 'the hook directory' : '--cwd';
    const cwd = directory === undefined ? process.cwd() : resolveCwd(directory, source);
    const { project, configPath } = await createProject(cwd, values);
    const mode = (values.mode ?? project.config.hook?.mode ?? 'agent') as HookMode;

    if (!MODES.has(mode)) {
      throw new Error(`comments: unknown mode ${mode}`);
    }

    if (mode === 'off') {
      return;
    }

    const summary = await runFlow(project, scopeFrom(positionals.slice(1), values), {
      mode,
      select: selectFrom(values, project),
      runner: parseRunner(values.runner) ?? project.config.agent?.runner ?? (host as AgentRunner),
      configPath,
      reporter: createLogReporter(log, { verbose: values.verbose }),
    });

    message = describeSummary(summary);
  } catch (error) {
    message = `comments: ${(error as Error).message.replace(/^comments: /, '')}`;
  } finally {
    if (message) {
      log(message);
    }

    process.stdout.write(`${hookOutput(host, message)}\n`);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const peeked = peek(argv);

  if (peeked.command === 'hook' && !peeked.help) {
    await runHook(argv);
    return 0;
  }

  const { values, positionals } = parse(argv);
  const [command, ...targets] = positionals;

  if (values.help || !command || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const cwd = values.cwd ? resolveCwd(values.cwd) : process.cwd();
  const { project, configPath } = await createProject(cwd, values);
  const scope = scopeFrom(targets, values);

  switch (command) {
    case 'list': {
      const analyses = await project.analyze(scope);

      const comments = commentsOf(analyses);

      printComments(values.suspicious ? comments.filter((comment) => isSuspicious(comment)) : comments, values);
      warnSkipped(analyses);
      hintEmptyScope(analyses, scope);
      return 0;
    }
    case 'check': {
      const analyses = await project.analyze(scope);

      const comments = commentsOf(analyses).filter((comment) => hasVerdictIssues(comment));

      printComments(comments, values);
      warnSkipped(analyses);
      hintEmptyScope(analyses, scope);

      if (!values.json) {
        log(comments.length > 0 ? `${comments.length} comment(s) with layout issues` : 'all comments fit the width');
      }

      return comments.length > 0 ? 1 : 0;
    }
    case 'wrap': {
      return runWrap(project, targets, values);
    }
    case 'agent': {
      const options: FlowOptions = {
        mode: 'agent',
        select: selectFrom(values, project),
        runner: parseRunner(values.runner) ?? project.config.agent?.runner ?? 'claude',
        configPath,
      };

      let summary: FlowSummary;

      if (isLiveTerminal()) {
        const ui = new TerminalUI();

        ui.begin('comments agent');

        try {
          summary = await runFlow(project, scope, { ...options, reporter: ui.reporter });
        } catch (error) {
          ui.dispose();
          throw error;
        }

        await ui.finish(summary, {
          interactive: process.stdin.isTTY && values.interactive !== false,
          verbose: values.verbose,
        });
      } else {
        summary = await runFlow(project, scope, {
          ...options,
          reporter: createLogReporter(log, { verbose: values.verbose }),
        });

        log(describeSummary(summary) ?? 'comments: nothing to do');
      }

      const failed = summary.remaining.length > 0 || summary.codeChanged.length > 0 || summary.agentError;

      return failed ? 1 : 0;
    }
    default: {
      log(`comments: unknown command ${command}\n`);
      process.stderr.write(HELP);
      return 2;
    }
  }
}
