import {
  intro,
  isCancel,
  isCI,
  log,
  note,
  S_BAR,
  S_BAR_END,
  S_RADIO_INACTIVE,
  S_STEP_ERROR,
  S_STEP_SUBMIT,
  select,
  spinner,
  unicode,
  unicodeOr,
  type SpinnerResult,
} from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { styleText } from 'node:util';
import type { CommentReport } from './analyze.js';
import {
  describeSkipped,
  type AgentPlan,
  type AgentRunReport,
  type FlowPlan,
  type FlowReporter,
  type FlowSummary,
} from './flow.js';

type Style = Parameters<typeof styleText>[0];

const FRAMES = unicode ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['|', '/', '-', '\\'];
const FRAME_MS = 80;
const S_DONE = unicodeOr('✔', '√');
const S_FAILED = unicodeOr('✖', 'x');
const HIDE_CURSOR = '\u001B[?25l';
const SHOW_CURSOR = '\u001B[?25h';
const LISTED_REMAINING = 10;
const CTRL_C = 0x03;
const MIN_FILES_WIDTH = 12;

type AgentState = 'queued' | 'running' | 'done' | 'failed';

const ICONS: Record<Exclude<AgentState, 'running'>, readonly [Style, string]> = {
  queued: ['dim', S_RADIO_INACTIVE],
  done: ['green', S_DONE],
  failed: ['red', S_FAILED],
};

interface AgentRow {
  readonly plan: AgentPlan;
  state: AgentState;
  startedAt?: number;
  durationMs?: number;
}

export function isLiveTerminal(output: NodeJS.WriteStream = process.stderr): boolean {
  return output.isTTY && !isCI() && process.env.TERM !== 'dumb';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatDuration(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  const minutes = Math.floor(total / 60);

  return minutes > 0 ? `${minutes}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`;
}

function fitFiles(files: readonly string[], width: number): string {
  for (let shown = files.length; shown > 0; shown -= 1) {
    const more = files.length - shown;
    const text = `${files.slice(0, shown).join(', ')}${more > 0 ? `, +${more} more` : ''}`;

    if (text.length <= width) {
      return text;
    }
  }

  return width > 1 ? `…${files[0].slice(-(width - 1))}` : '';
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(width - 1, 0))}…` : text;
}

function agentLabel(index: number): string {
  return `agent ${index + 1}`;
}

function formatReply(text: string, paint: (style: Style, text: string) => string): string {
  return text
    .replaceAll(/\*\*([^*\n]+)\*\*/g, (_, inner: string) => paint('bold', inner))
    .replaceAll(/`([^`\n]+)`/g, (_, inner: string) => paint('cyan', inner));
}

class AgentTable {
  private _rows: AgentRow[] = [];
  private _title = '';
  private _drawn = 0;
  private _frame = 0;
  private _startedAt = 0;
  private _timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly _output: NodeJS.WriteStream,
    private readonly _paint: (style: Style, text: string) => string,
  ) {}

  private readonly _restoreCursor = (): void => {
    this._output.write(SHOW_CURSOR);
  };

  private readonly _interrupt = (): void => {
    this._restoreCursor();
    process.off('exit', this._restoreCursor);

    // without a listener left, the signal ends the process the way it would have without this one
    process.kill(process.pid, 'SIGINT');
  };

  start(plan: FlowPlan, title: string): void {
    this._rows = plan.agents.map((agent) => {
      return { plan: agent, state: 'queued' };
    });

    this._title = title;
    this._startedAt = Date.now();

    process.once('SIGINT', this._interrupt);
    process.once('exit', this._restoreCursor);

    this._output.write(`${this._paint('gray', S_BAR)}\n${HIDE_CURSOR}`);
    this._draw(false);

    this._timer = setInterval(() => {
      this._frame = (this._frame + 1) % FRAMES.length;

      this._draw(false);
    }, FRAME_MS);
  }

  started(index: number): void {
    this._rows[index].state = 'running';
    this._rows[index].startedAt = Date.now();
  }

  finished(index: number, report: AgentRunReport): void {
    this._rows[index].state = report.ok ? 'done' : 'failed';
    this._rows[index].durationMs = report.durationMs;
  }

  stop(): void {
    if (this._timer === undefined) {
      return;
    }

    clearInterval(this._timer);

    this._timer = undefined;

    this._draw(true);
    this._restoreCursor();

    process.off('SIGINT', this._interrupt);
    process.off('exit', this._restoreCursor);
  }

  private _draw(final: boolean): void {
    const lines = this._render(final);
    const clear = this._drawn > 0 ? `\u001B[${this._drawn}F\u001B[J` : '';

    this._output.write(`${clear}${lines.join('\n')}\n`);

    this._drawn = lines.length;
  }

  private _count(state: AgentState): number {
    return this._rows.filter((row) => row.state === state).length;
  }

  private _render(final: boolean): string[] {
    const columns = Math.max((this._output.columns || 80) - 1, 20);
    const elapsed = formatDuration(Date.now() - this._startedAt);
    const failed = this._count('failed');
    const finished = this._count('done') + failed;

    let header: string;

    if (final) {
      const outcome = `${plural(this._rows.length, 'agent')} finished in ${elapsed}${failed > 0 ? `, ${failed} failed` : ''}`;
      const symbol = failed > 0 ? this._paint('yellow', S_STEP_ERROR) : this._paint('green', S_STEP_SUBMIT);

      header = `${symbol}  ${truncate(outcome, columns - 3)}`;
    } else {
      const progress = `${finished} of ${this._rows.length} done, ${elapsed}`;
      const text = truncate(`${this._title}  ${progress}`, columns - 3);

      header = `${this._paint('magenta', FRAMES[this._frame])}  ${text.replace(progress, this._paint('dim', progress))}`;
    }

    return [header, ...this._renderRows(columns, final)];
  }

  private _renderRows(columns: number, final: boolean): string[] {
    const bar = this._paint('gray', S_BAR);
    const nameWidth = agentLabel(this._rows.length - 1).length;
    const commentsWidth = Math.max(...this._rows.map((row) => plural(row.plan.comments, 'comment').length));
    const statusWidth = Math.max(...this._rows.map((row) => this._status(row).length));
    const filesWidth = columns - (3 + 2 + nameWidth + 2 + commentsWidth + 2 + statusWidth + 2);

    // a table taller than the terminal can't be redrawn in place
    const height = (this._output.rows || 24) - 3;

    const visible = this._rows
      .map((row, index) => {
        return { row, index };
      })
      .filter(({ row }) => final || row.state === 'running')
      .slice(0, Math.max(height - 1, 1));

    const lines = visible.map(({ row, index }) => {
      const status = this._status(row).padEnd(statusWidth);

      const files =
        filesWidth >= MIN_FILES_WIDTH ? `  ${this._paint('dim', fitFiles(row.plan.files, filesWidth))}` : '';

      return (
        [
          `${bar}  ${this._icon(row)} ${agentLabel(index).padEnd(nameWidth)}`,
          this._paint('dim', plural(row.plan.comments, 'comment').padEnd(commentsWidth)),
          this._paint(this._statusStyle(row), status),
        ].join('  ') + files
      );
    });

    if (!final) {
      const failed = this._count('failed');

      const summary = [
        `${S_DONE} ${this._count('done')} done`,
        ...(failed > 0 ? [`${S_FAILED} ${failed} failed`] : []),
        `${S_RADIO_INACTIVE} ${this._count('queued')} queued`,
      ].join(', ');

      lines.push(`${bar}  ${this._paint('dim', summary)}`);
    }

    return lines;
  }

  private _icon(row: AgentRow): string {
    if (row.state === 'running') {
      return this._paint('magenta', FRAMES[this._frame]);
    }

    const [style, symbol] = ICONS[row.state];

    return this._paint(style, symbol);
  }

  private _status(row: AgentRow): string {
    if (row.state === 'queued') {
      return 'queued';
    }

    if (row.state === 'running') {
      return formatDuration(Date.now() - (row.startedAt ?? this._startedAt));
    }

    return formatDuration(row.durationMs ?? 0);
  }

  private _statusStyle(row: AgentRow): Style {
    switch (row.state) {
      case 'running': {
        return 'cyan';
      }
      case 'failed': {
        return 'red';
      }
      default: {
        return 'dim';
      }
    }
  }
}

export interface FinishOptions {
  /**
   * Offers to open each agent's reply, which needs a terminal on stdin to read the choice.
   */
  readonly interactive: boolean;

  /**
   * Prints every agent's reply instead of offering to open them.
   */
  readonly verbose?: boolean;
}

export class TerminalUI {
  readonly reporter: FlowReporter;
  private readonly _table: AgentTable;
  private _busy: SpinnerResult | undefined;
  private _muted = false;

  constructor(private readonly _output: NodeJS.WriteStream & { readonly fd: number } = process.stderr) {
    this._table = new AgentTable(_output, this._paint);

    this.reporter = {
      start: (plan) => {
        const queueing = plan.agents.length > plan.maxAgents ? `, ${plan.maxAgents} at a time` : '';

        this._stopSpinner(`Found ${plural(plan.comments, 'comment')} to review in ${plural(plan.files, 'file')}`);

        // only after the spinner stopped, since it blocks input itself and turns raw mode off when it stops
        this._muteInput();
        this._table.start(plan, `Running ${plural(plan.agents.length, 'agent')} (${plan.agent})${queueing}`);
      },
      agentStarted: (index) => {
        this._table.started(index);
      },
      agentFinished: (index, report) => {
        this._table.finished(index, report);
      },
      stop: () => {
        this._table.stop();
        this._unmuteInput();
      },
    };
  }

  private readonly _paint = (style: Style, text: string): string => {
    return styleText(style, text, { stream: this._output });
  };

  begin(title: string): void {
    intro(this._paint('inverse', ` ${title} `), { output: this._output });
    this._startSpinner('Finding comments');
  }

  dispose(): void {
    this._unmuteInput();
    this._table.stop();
    this._stopSpinner();
  }

  async finish(summary: FlowSummary, options: FinishOptions): Promise<void> {
    const output = this._output;
    const runs = summary.runs ?? [];

    if (summary.sentToAgent === 0) {
      this._stopSpinner('No comment in scope needs an agent');

      if (summary.rewrapped) {
        log.info(`Rewrapped ${plural(summary.rewrapped, 'comment')} to fix their layout`, { output });
      }

      if (summary.remaining.length > 0) {
        log.warn(this._describeRemaining(summary.remaining), { output });
      }

      this._warnSkipped(summary);
      this._outro(summary.rewrapped ? 'Done' : 'Nothing to do');
      return;
    }

    for (const [index, run] of runs.entries()) {
      if (!run.ok) {
        log.error(`${agentLabel(index)} failed: ${run.error}`, { output });
      }
    }

    if (summary.codeChanged.length > 0) {
      log.warn(`The agents changed code, not just comments, in ${summary.codeChanged.join(', ')}`, { output });
    }

    if (summary.changedElsewhere.length > 0) {
      const files = plural(summary.changedElsewhere.length, 'file');

      log.warn(`${files} that no agent was given changed during the run: ${summary.changedElsewhere.join(', ')}`, {
        output,
      });
    }

    if (summary.rewrapped) {
      log.info(`Rewrapped ${plural(summary.rewrapped, 'comment')} to fix their layout`, { output });
    }

    if (summary.remaining.length > 0) {
      log.warn(this._describeRemaining(summary.remaining), { output });
    } else {
      log.success('Every comment passes the check now', { output });
    }

    this._warnSkipped(summary);

    if (options.verbose) {
      for (const [index, run] of runs.entries()) {
        this._showReply(run, index, summary.remaining);
      }
    } else if (options.interactive) {
      await this._browse(runs, summary.remaining);
    }

    const clean = summary.remaining.length === 0 && summary.codeChanged.length === 0 && !summary.agentError;

    this._outro(clean ? 'Done' : 'Done, but some comments need a look');
  }

  private _warnSkipped(summary: FlowSummary): void {
    for (const skipped of summary.skipped) {
      const text = describeSkipped(skipped);

      log.warn(`${text.charAt(0).toUpperCase()}${text.slice(1)}`, { output: this._output });
    }
  }

  /**
   * Closes the guide like clack's `outro`, which always ends with an empty line.
   */
  private _outro(message: string): void {
    this._output.write(`${this._paint('gray', S_BAR)}\n${this._paint('gray', S_BAR_END)}  ${message}\n`);
  }

  /**
   * Keeps the terminal from echoing keys, like `^[[B` for the down arrow, into the output while
   * it redraws. Raw mode also stops the terminal from turning Ctrl-C into a signal, so the input
   * handler sends it instead.
   */
  private _muteInput(): void {
    const { stdin } = process;

    if (!stdin.isTTY || this._muted) {
      return;
    }

    this._muted = true;

    stdin.setRawMode(true);
    stdin.on('data', this._discardInput);
    stdin.resume();
  }

  private _unmuteInput(): void {
    const { stdin } = process;

    if (!this._muted) {
      return;
    }

    this._muted = false;

    stdin.off('data', this._discardInput);
    stdin.setRawMode(false);
    stdin.pause();
  }

  private readonly _discardInput = (data: Buffer): void => {
    if (!data.includes(CTRL_C)) {
      return;
    }

    this._unmuteInput();

    // like the terminal, signal the whole process group, so that the agents stop too
    try {
      process.kill(0, 'SIGINT');
    } catch {
      process.kill(process.pid, 'SIGINT');
    }
  };

  private _startSpinner(message: string): void {
    this._busy = spinner({ output: this._output, frames: FRAMES, delay: FRAME_MS });

    this._busy.start(message);
  }

  private _stopSpinner(message?: string): void {
    if (message === undefined) {
      this._busy?.clear();
    } else {
      this._busy?.stop(message);
    }

    this._busy = undefined;
  }

  private _describeRemaining(remaining: readonly CommentReport[]): string {
    const locations = remaining.map((comment) => `${comment.file}:${comment.startLine}`);
    const width = Math.max(...locations.slice(0, LISTED_REMAINING).map((location) => location.length));

    const listed = remaining.slice(0, LISTED_REMAINING).map((comment, index) => {
      const issues = comment.paragraphs.flatMap((paragraph) => paragraph.issues);
      const types = new Set(issues.filter((issue) => issue.tier === 'verdict').map((issue) => issue.type));

      return `  ${locations[index].padEnd(width)}  ${this._paint('dim', [...types].join(', '))}`;
    });

    const more =
      remaining.length > LISTED_REMAINING
        ? [this._paint('dim', `  and ${remaining.length - LISTED_REMAINING} more`)]
        : [];

    return [
      `${plural(remaining.length, 'comment')} still ${remaining.length === 1 ? 'has' : 'have'} issues`,
      ...listed,
      ...more,
    ].join('\n');
  }

  private _remainingIn(run: AgentRunReport, remaining: readonly CommentReport[]): number {
    return remaining.filter((comment) => run.files.includes(comment.file)).length;
  }

  private _describeRun(run: AgentRunReport, remaining: readonly CommentReport[]): string {
    if (!run.ok) {
      return `failed after ${formatDuration(run.durationMs)}`;
    }

    const left = this._remainingIn(run, remaining);

    return [
      plural(run.comments, 'comment'),
      formatDuration(run.durationMs),
      ...(left > 0 ? [`${left} still ${left === 1 ? 'has' : 'have'} issues`] : []),
    ].join(', ');
  }

  private _showReply(
    run: AgentRunReport,
    index: number,
    remaining: readonly CommentReport[],
    output: Writable = this._output,
  ): void {
    const reply = run.output ? formatReply(run.output, this._paint) : this._paint('dim', 'The agent printed nothing.');
    const error = run.ok ? [] : [this._paint('red', run.error ?? 'The agent failed.'), ''];
    const files = this._paint('dim', run.files.join(', '));
    const title = `${agentLabel(index)}, ${this._describeRun(run, remaining)}`;

    note([files, '', ...error, reply].join('\n'), title, { output, withGuide: output === this._output });
  }

  /**
   * Opens an agent's reply in `less`, which shows it on the alternate screen and restores the
   * terminal when it quits, so that opening replies doesn't pile them up in the scrollback.
   */
  private _openReply(run: AgentRunReport, index: number, remaining: readonly CommentReport[]): void {
    let text = '';

    const capture = Object.assign(
      new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          text += String(chunk);

          callback();
        },
      }),
      { columns: this._output.columns || 80 },
    );

    this._showReply(run, index, remaining, capture);

    const prompt = `${agentLabel(index)}, press q to go back`.replaceAll(/[?:.%\\]/g, String.raw`\$&`);

    // `-+` resets options that a user's `LESS` variable may set to quit early or skip the alternate screen
    const result = spawnSync('less', ['-R', '-c', '-~', '-+F', '-+E', '-+X', `-Ps${prompt}`], {
      input: text,
      stdio: ['pipe', this._output.fd, 'inherit'],
    });

    if (result.error) {
      this._showReply(run, index, remaining);
    }
  }

  /**
   * Erases what a closed `select` prompt left behind, its guide line, message, and choice, plus a
   * closing guide line when it was cancelled.
   */
  private _erasePrompt(cancelled: boolean): void {
    const lines = cancelled ? 4 : 3;

    this._output.write(`\u001B[${lines}F\u001B[J`);
  }

  private async _browse(runs: readonly AgentRunReport[], remaining: readonly CommentReport[]): Promise<void> {
    const done = -1;
    const columns = (this._output.columns || 80) - 1;
    const nameWidth = agentLabel(runs.length - 1).length;

    const options = runs.map((run, index) => {
      const icon = run.ok ? this._paint('green', S_DONE) : this._paint('red', S_FAILED);
      const hint = this._describeRun(run, remaining);

      // the prompt's guide, radio, icon, and spaces take 9 columns, and the hint shows in parentheses
      const filesWidth = Math.max(columns - 9 - nameWidth - 2 - (hint.length + 3), MIN_FILES_WIDTH);

      return {
        value: index,
        label: `${icon} ${agentLabel(index).padEnd(nameWidth)}  ${fitFiles(run.files, filesWidth)}`,
        hint,
      };
    });

    let initial = done;

    for (;;) {
      const choice = await select<number>({
        message: "Open an agent's reply",
        options: [...options, { value: done, label: 'Done' }],
        initialValue: initial,
        output: this._output,
      });

      this._erasePrompt(isCancel(choice));

      if (isCancel(choice) || choice === done) {
        return;
      }

      this._openReply(runs[choice], choice, remaining);

      initial = choice;
    }
  }
}
