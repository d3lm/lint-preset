import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildInvocation, buildPrompt, describeAgent, formatInvocation, loadRules, runAgent } from './agent.js';
import {
  BYTE_ORDER_MARK,
  codeFingerprint,
  hasVerdictIssues,
  rewrapComment,
  type CommentReport,
  type SyntaxFailure,
} from './analyze.js';
import type { AgentRunner, AgentScope } from './config.js';
import type { FileAnalysis, Project, Scope } from './project.js';

export interface FlowOptions {
  readonly mode: 'agent' | 'report';
  readonly select: AgentScope;
  readonly runner: AgentRunner;
  readonly configPath?: string;
  readonly reporter?: FlowReporter;
}

export interface AgentPlan {
  readonly name: string;
  readonly files: readonly string[];
  readonly comments: number;
}

export interface AgentRunReport extends AgentPlan {
  readonly ok: boolean;
  readonly error?: string;
  readonly output: string;
  readonly durationMs: number;
}

export interface FlowPlan {
  readonly agent: string;
  readonly command: string;
  readonly comments: number;
  readonly files: number;
  readonly maxAgents: number;
  readonly agents: readonly AgentPlan[];
}

export interface FlowReporter {
  start(plan: FlowPlan): void;
  agentStarted(index: number): void;
  agentFinished(index: number, report: AgentRunReport): void;
  stop(): void;
}

export interface FlowSummary {
  readonly sentToAgent: number;
  readonly agents?: number;

  /**
   * Lists every agent that ran, in the order they were planned.
   */
  readonly runs?: readonly AgentRunReport[];
  readonly codeChanged: readonly string[];

  /**
   * Lists the files that no agent was given and that changed while the agents ran. Only a git
   * repository shows which files those are. An agent's edit looks the same as one that somebody
   * else made in that time, so this is a report and not a failure.
   */
  readonly changedElsewhere: readonly string[];
  readonly rewrapped?: number;

  /**
   * Hints don't count, since the agent may have rightly kept what a heuristic flagged.
   */
  readonly remaining: readonly CommentReport[];

  /**
   * Lists the files in scope whose comments weren't read because of a syntax error.
   */
  readonly skipped: readonly SkippedFile[];
  readonly agentError?: string;
}

export interface SkippedFile {
  readonly file: string;
  readonly syntaxError: SyntaxFailure;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_AGENTS = 6;
const PROGRESS_INTERVAL_MS = 30_000;
const LISTED_FILES = 3;

function withVerdictIssues(analyses: readonly FileAnalysis[]): CommentReport[] {
  return analyses.flatMap((analysis) => analysis.comments).filter((comment) => hasVerdictIssues(comment));
}

export function skippedFiles(analyses: readonly FileAnalysis[]): SkippedFile[] {
  return analyses.flatMap(({ file, syntaxError }) => (syntaxError ? [{ file, syntaxError }] : []));
}

export function describeSkipped({ file, syntaxError }: SkippedFile): string {
  const line = syntaxError.line === undefined ? '' : ` on line ${syntaxError.line}`;

  return `skipped ${file} because of a syntax error${line} (${syntaxError.message})`;
}

export function describeChangedElsewhere(files: readonly string[]): string {
  return `${files.length} file(s) that no agent was given changed during the run: ${listFiles(files)}`;
}

/**
 * Lists the files whose state differs between two snapshots, including files that only one
 * of them holds.
 */
function changedBetween(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const files = new Set([...before.keys(), ...after.keys()]);

  return [...files].filter((file) => before.get(file) !== after.get(file)).toSorted();
}

/**
 * A paragraph without a suggestion is in a part the tool keeps as written, like an overflowing
 * single-line block comment, so only the agent can fix it.
 */
function needsAgent(comment: CommentReport): boolean {
  return comment.paragraphs.some((paragraph) =>
    paragraph.issues.some((issue) => issue.tier === 'hint' || paragraph.suggestion === null),
  );
}

function seconds(milliseconds: number): string {
  return `${Math.round(milliseconds / 1000)}s`;
}

function listFiles(files: readonly string[]): string {
  const more = files.length > LISTED_FILES ? `, and ${files.length - LISTED_FILES} more` : '';

  return `${files.slice(0, LISTED_FILES).join(', ')}${more}`;
}

const SILENT_REPORTER: FlowReporter = {
  start: () => {},
  agentStarted: () => {},
  agentFinished: () => {},
  stop: () => {},
};

/**
 * Reports progress as plain log lines, for hooks, CI, and output that isn't a terminal.
 */
export function createLogReporter(log: (message: string) => void, options: { verbose?: boolean } = {}): FlowReporter {
  let plan: FlowPlan | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let started = 0;
  let running = 0;
  let finished = 0;

  return {
    start(next) {
      plan = next;
      started = Date.now();

      const count = next.agents.length;
      const agents = `${count} agent${count > 1 ? 's' : ''} (${next.agent})`;
      const queueing = count > next.maxAgents ? `, ${next.maxAgents} at a time,` : '';

      log(`spawning ${agents}${queueing} for ${next.comments} comment(s) in ${next.files} file(s)`);
      log(`  command: ${next.command}`);

      if (count > 1) {
        for (const agent of next.agents) {
          log(`  ${agent.name}: ${agent.comments} comment(s) in ${listFiles(agent.files)}`);
        }
      }

      heartbeat = setInterval(() => {
        const queued = count - finished - running;
        const waiting = count > 1 ? `${count - finished} of ${count} agents` : 'the agent';

        log(`still waiting for ${waiting}${queued > 0 ? `, ${queued} queued` : ''} (${seconds(Date.now() - started)})`);
      }, PROGRESS_INTERVAL_MS);
    },
    agentStarted(index) {
      running += 1;

      if (plan && index >= plan.maxAgents) {
        log(`${plan.agents[index].name} started`);
      }
    },
    agentFinished(_index, report) {
      running -= 1;
      finished += 1;

      const count = plan?.agents.length ?? 1;
      const took = seconds(report.durationMs);
      const status = report.ok ? `finished in ${took}` : `failed after ${took}`;
      const progress = count > 1 ? ` (${finished} of ${count} done)` : '';

      log(`${report.name} ${status}${progress}${report.ok ? '' : `: ${report.error}`}`);

      if (report.output && (options.verbose || !report.ok)) {
        log(report.output);
      }
    },
    stop() {
      clearInterval(heartbeat);
    },
  };
}

export function batchFiles<T extends { readonly comments: readonly unknown[] }>(
  files: readonly T[],
  batchSize: number,
  maxFiles = Infinity,
): T[][] {
  const total = files.reduce((sum, file) => sum + file.comments.length, 0);
  const order = files.map((_, index) => index).toSorted((a, b) => files[b].comments.length - files[a].comments.length);
  const minimum = Math.max(Math.ceil(total / batchSize), Math.ceil(files.length / maxFiles));

  for (let count = Math.min(files.length, minimum); ; count += 1) {
    const sizes = Array.from<number>({ length: count }).fill(0);
    const indices = Array.from({ length: count }, (): number[] => []);

    for (const index of order) {
      const open = sizes.map((size, batch) => (indices[batch].length < maxFiles ? size : Infinity));
      const smallest = open.indexOf(Math.min(...open));

      indices[smallest].push(index);

      sizes[smallest] += files[index].comments.length;
    }

    const fits = indices.every((batch, index) => batch.length === 1 || sizes[index] <= batchSize);

    if (fits || count >= files.length) {
      return indices.map((batch) => batch.toSorted((a, b) => a - b).map((index) => files[index]));
    }
  }
}

async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });

  let next = 0;

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;

      next += 1;

      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));

  return results;
}

function applyRewraps(analyses: readonly FileAnalysis[], skip: ReadonlySet<string>): number {
  let count = 0;

  for (const analysis of analyses) {
    const comments = analysis.comments.filter((comment) => hasVerdictIssues(comment));

    if (comments.length === 0 || skip.has(analysis.file)) {
      continue;
    }

    const lines = analysis.source.split('\n');

    let rewrapped = 0;

    for (const comment of comments.toReversed()) {
      const text = rewrapComment(comment);

      // a comment whose only issues are in parts that are kept as written has nothing to apply
      if (text === comment.text) {
        continue;
      }

      /**
       * A report holds the comment without the file's byte order mark and without carriage returns,
       * so the first line of the file and the lines of a CRLF file get theirs back.
       */
      const first = lines[comment.startLine - 1];
      const mark = first.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
      const ending = first.endsWith('\r') ? '\r' : '';
      const replacement = text.split('\n').map((line, index) => `${index === 0 ? mark : ''}${line}${ending}`);

      lines.splice(comment.startLine - 1, comment.endLine - comment.startLine + 1, ...replacement);

      rewrapped += 1;
    }

    const output = lines.join('\n');

    if (rewrapped === 0 || codeFingerprint(output, analysis.file) !== codeFingerprint(analysis.source, analysis.file)) {
      continue;
    }

    writeFileSync(analysis.absolute, output);

    count += rewrapped;
  }

  return count;
}

export async function runFlow(project: Project, scope: Scope, options: FlowOptions): Promise<FlowSummary> {
  const reporter = options.reporter ?? SILENT_REPORTER;
  const analyses = await project.analyze(scope);

  // the tool changes files in between, so the files are measured again for what remains
  const measure = async (): Promise<Pick<FlowSummary, 'remaining' | 'skipped'>> => {
    const current = await project.analyze(scope);

    return { remaining: withVerdictIssues(current), skipped: skippedFiles(current) };
  };

  if (options.mode === 'report') {
    return {
      sentToAgent: 0,
      codeChanged: [],
      changedElsewhere: [],
      remaining: withVerdictIssues(analyses),
      skipped: skippedFiles(analyses),
    };
  }

  const pending = analyses
    .map((analysis) => {
      const selected =
        options.select === 'all' ? analysis.comments : analysis.comments.filter((comment) => needsAgent(comment));

      return { ...analysis, comments: selected };
    })
    .filter((analysis) => analysis.comments.length > 0);

  const comments = pending.flatMap((analysis) => analysis.comments);

  if (comments.length === 0) {
    const rewrapped = applyRewraps(analyses, new Set());

    return { sentToAgent: 0, codeChanged: [], changedElsewhere: [], rewrapped, ...(await measure()) };
  }

  const agentConfig = project.config.agent ?? {};
  const rules = loadRules(agentConfig, options.configPath);

  const batches = batchFiles(
    pending,
    agentConfig.batchSize ?? DEFAULT_BATCH_SIZE,
    agentConfig.maxFiles ?? DEFAULT_MAX_FILES,
  );

  const maxAgents = agentConfig.maxAgents ?? DEFAULT_MAX_AGENTS;

  const runs = batches.map((batch, index) => {
    const batchComments = batch.flatMap((analysis) => analysis.comments);

    const prompt = buildPrompt({ rules, root: project.root, comments: batchComments });
    const invocation = buildInvocation({ agent: agentConfig, runner: options.runner, prompt, root: project.root });

    return {
      name: batches.length > 1 ? `agent ${index + 1}` : 'the agent',
      files: batch.map((analysis) => analysis.file),
      comments: batchComments.length,
      invocation,
    };
  });

  reporter.start({
    agent: describeAgent(agentConfig, options.runner),
    command: formatInvocation(runs[0].invocation),
    comments: comments.length,
    files: pending.length,
    maxAgents,
    agents: runs.map(({ name, files, comments }) => {
      return { name, files, comments };
    }),
  });

  const before = project.snapshot();

  let reports: AgentRunReport[];

  try {
    reports = await runPool(runs, maxAgents, async (run, index) => {
      const start = Date.now();

      reporter.agentStarted(index);

      const result = await runAgent(run.invocation, { root: project.root, timeout: agentConfig.timeout });

      const report: AgentRunReport = {
        name: run.name,
        files: run.files,
        comments: run.comments,
        ok: result.ok,
        error: result.error,
        output: result.output,
        durationMs: Date.now() - start,
      };

      reporter.agentFinished(index, report);

      return report;
    });
  } finally {
    reporter.stop();
  }

  const agentErrors = reports.flatMap((report, index) => {
    if (report.ok) {
      return [];
    }

    return [reports.length > 1 ? `agent ${index + 1} of ${reports.length}: ${report.error}` : (report.error ?? '')];
  });

  // taken before the tool rewraps anything itself
  const after = project.snapshot();
  const handedOver = new Set(pending.map((analysis) => analysis.file));

  const changedElsewhere = before && after ? changedBetween(before, after).filter((file) => !handedOver.has(file)) : [];

  const codeChanged = pending
    .filter((analysis) => {
      if (!existsSync(analysis.absolute)) {
        return true;
      }

      const current = readFileSync(analysis.absolute, 'utf8');

      return codeFingerprint(current, analysis.file) !== codeFingerprint(analysis.source, analysis.file);
    })
    .map((analysis) => analysis.file);

  const rewrapped = applyRewraps(await project.analyze(scope), new Set(codeChanged));

  return {
    sentToAgent: comments.length,
    agents: runs.length,
    runs: reports,
    codeChanged,
    changedElsewhere,
    rewrapped,
    ...(await measure()),
    agentError: agentErrors.length > 0 ? agentErrors.join(', ') : undefined,
  };
}

const LISTED_COMMENTS = 5;

function describeRemaining(remaining: readonly CommentReport[]): string {
  const listed = remaining.slice(0, LISTED_COMMENTS).map((comment) => {
    const issues = comment.paragraphs.flatMap((paragraph) => paragraph.issues);
    const types = new Set(issues.filter((issue) => issue.tier === 'verdict').map((issue) => issue.type));

    return `${comment.file}:${comment.startLine} (${[...types].join(', ')})`;
  });

  const more = remaining.length > LISTED_COMMENTS ? `, and ${remaining.length - LISTED_COMMENTS} more` : '';

  return `${remaining.length} comment(s) still have issues: ${listed.join(', ')}${more}`;
}

export function describeSummary(summary: FlowSummary): string | undefined {
  const parts: string[] = [];

  if (summary.sentToAgent > 0) {
    const agents = (summary.agents ?? 1) > 1 ? `${summary.agents} agents` : 'the agent';

    parts.push(`sent ${summary.sentToAgent} comment(s) to ${agents}`);
  }

  if (summary.rewrapped) {
    parts.push(`rewrapped ${summary.rewrapped} comment(s)`);
  }

  if (summary.agentError) {
    parts.push(`agent failed: ${summary.agentError}`);
  }

  if (summary.codeChanged.length > 0) {
    parts.push(`the agent changed code, not just comments, in ${summary.codeChanged.join(', ')}`);
  }

  if (summary.changedElsewhere.length > 0) {
    parts.push(describeChangedElsewhere(summary.changedElsewhere));
  }

  if (summary.remaining.length > 0) {
    parts.push(describeRemaining(summary.remaining));
  }

  parts.push(...summary.skipped.map((skipped) => describeSkipped(skipped)));

  return parts.length > 0 ? `comments: ${parts.join('; ')}` : undefined;
}
