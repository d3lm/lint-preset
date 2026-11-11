import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CommentReport, IssueReport, IssueType, ParagraphReport } from './analyze.js';
import type { AgentConfig, AgentRunner } from './config.js';

/**
 * This variable is set in the agent's environment so that the agent's own stop hook doesn't
 * spawn another agent.
 */
export const CHILD_ENV = 'COMMENTS_HOOK_CHILD';

export const DEFAULT_RULES = `
# Comment rules

## Priorities

When rules pull in different directions, the earlier one wins.

1. Keep code and exact text byte for byte, including every punctuation character in it. That covers code blocks, \`@example\`, code spans, identifiers, string literals like error messages, regexes, globs and other patterns like \`*test*\`, URLs, quoted text, titles, and notation like \`host:port\`.
2. Keep the meaning. An edit may make a comment clearer, never different.
3. Follow the style preferences below.
4. Change as little as possible. Wording that already reads clearly stays, even when a note points at it.

## Layout

- After you finish, the tool rewraps prose paragraphs, list items, and JSDoc tag descriptions. The width is a preferred target. A parenthetical may extend a line up to the configured maximum so it stays together, and lines may go up to the configured tolerance past the width when that saves a line. In longer paragraphs, balanced lines take priority over keeping every parenthetical on one line. The tool also avoids short last lines where possible. Leave these line breaks to the tool, except for the sentence-orphan case below.
- Don't end a line with the first word of a new sentence, clause, or parenthetical, like \`This\` after a period, \`the\` after a comma, or \`(the\`. Move it to the next line instead. A long word, like an identifier or a code span, may stay at the end of a line when moving it would leave that line far shorter than the lines around it. Then leave the line breaks as they are.
- In a paragraph of two lines, the first line ends with a sentence whenever the rest fits on the second line and is no longer than the first. Don't end it with the start of the next sentence, like \`A wrap\` in \`...lay out differently. A wrap\`. Move those words to the second line instead.
- A comment whose whole text is one paragraph stays on a single line when that line fits a separate, larger single-line width, even past the width. Only a longer comment wraps to the width.
- Separate paragraphs with an empty comment line.
- Never split a backtick code span across lines.
- Keep code blocks, \`@example\`, lists, tables, box drawings, aligned columns, and Markdown hard line breaks (a line that ends with two spaces or a backslash) laid out as they are. List items wrap with their continuation lines indented to the item text, and a JSDoc tag description that doesn't fit continues on the next line without indentation.
- The tool measures every line, taking the tolerance and the parts it keeps as written into account, and the notes on each comment list what is still wrong. Act on those notes. Don't count columns, and don't apply a stricter limit than the notes show.
- The maximum is a hard limit for measured prose, including long tokens. If a URL, code span, or other exact text exceeds it, preserve that text and explain the unresolved overflow instead of changing its contents.
- The tool never rewraps the parts it keeps as written, like a single-line block comment, a paragraph with hard line breaks, or lines that may be laid out by hand. When a note says one of their prose lines is too long, break or shorten it yourself. Exact text and intentional layout win over the width, so keep code, code spans, and the layout in them intact, and if a note can only be fixed by changing them, leave it and say why in your reply.

## Style

These are preferences for comment prose. They never apply to code or exact text (see the priorities above), and a punctuation character on its own is never a reason to edit prose that already reads clearly.

- Write clear sentences that flow. Descriptions read best as complete sentences with a subject and a verb, so prefer "Returns the bytes the guest sent" over a fragment like \`Bytes from the guest.\` or \`Optional.\` Imperative or third-person verb phrases like "Resolve a hostname..." or "Aborts every channel..." are fine, since the preference is against verb-less fragments, not against concise sentences.
- Prefer plain sentence punctuation. Where a semicolon, an em-dash (—), or a spaced hyphen, en-dash, or double hyphen standing in for one only joins two thoughts, a period, a comma, parentheses, or a word like "and", "so", or "because" usually reads better. Keep the punctuation where it carries meaning or reads more clearly than the alternatives.
- Prefer a sentence over a "Label: explanation" fragment, like \`...the socket. Optional: without it...\` or \`Default: refuse\` in the middle of prose. A colon is fine where it introduces a list, code block, or example, in a term's definition, in notation, in a quotation, and in a \`Note:\` or \`Optional:\` that starts a comment. A JSDoc tag like \`@note\` or \`@todo\` can replace a label, and \`@default\` fits a default value, not a description.
- Avoid asterisk emphasis like \`*this*\`, and use plain wording instead. A name or pattern in asterisks, like \`*test*\` or \`*.spec.ts\`, is a pattern, so keep its asterisks and wrap it in a code span, like \`\` \`*test*\` \`\`.
- Avoid section banner comments, i.e. dividers or headings made of dashes, equals signs, asterisks, or other repeated characters that split a file into visual sections. Let the code structure carry the grouping, or write one short, plain sentence comment (e.g. \`// handlers for control mode\`). Rules that belong to a diagram, a table, a box drawing, a Markdown document, an example, or a legal header aren't banners.
- Block and JSDoc comments are capitalized and end with punctuation.
- Never turn a block or JSDoc comment into \`//\` line comments, and never write a run of consecutive \`//\` lines.

## Editing

- Keep the wording unless it goes against a rule above. Then reword as little as needed and keep the meaning.
- Don't reword anything else unless the instructions below allow it.
`.trim();

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_CLAUDE_MODEL = 'haiku';

/**
 * Sets the longest time an agent gets to exit after its timeout before it is killed.
 */
const KILL_GRACE_MS = 5000;

/**
 * Sets how long to wait for the rest of the output after the agent exited. A process that the agent
 * left behind keeps the pipes open for as long as it runs.
 */
const DRAIN_GRACE_MS = 1000;

const RUNNER_COMMANDS: Record<AgentRunner, string> = {
  claude: 'claude',
  codex: 'codex',
  cursor: 'cursor-agent',
};

export interface AgentInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
}

export interface AgentResult {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
}

// hints are phrased as possibilities, since they come from heuristics that the agent may reject
const ISSUE_DESCRIPTIONS: Record<Exclude<IssueType, 'overflow'>, string> = {
  underfill: 'ends early, and words from the next line fit on it',
  widow: 'leaves fewer than three words on the last line of its paragraph',
  unbalanced: 'is in a paragraph whose lines are less even than the suggested rewrap',
  orphan:
    'may end with the start of a new sentence, clause, or parenthetical, which belongs on the next line (leave it if the period or comma before it is part of an abbreviation, a name, or notation like `No. 3`, or if it is a long word like an identifier and moving it would leave the line far shorter than the lines around it)',
  'split-parenthetical':
    'may split a parenthetical that the suggested rewrap keeps on one line, past the width but within the maximum (leave it if the split reads as well, like at a comma inside a list, and the line stays closer to the width)',
  'em-dash':
    "may use an em-dash to join two thoughts (leave it if it's in a quotation, a title, or a string literal, or reads more clearly than the alternatives)",
  banner:
    "may be a section banner (leave it if it's part of a diagram, a table, a box, a Markdown rule, a separator in an example, or legal text)",
  semicolon:
    "may join clauses with a semicolon (leave it if it's code, a literal, not a clause join, or reads more clearly than a period or a joining word)",
  'label-colon':
    'may use a colon after a label (leave it if it introduces a list or code, defines a term, is notation like a time or `key: value`, or is a `Note:` or `Optional:` that starts the comment)',
  emphasis:
    'may use asterisk emphasis (leave the asterisks of a name or pattern like `*test*`, which belongs in a code span with its asterisks)',
  dash: "may use a spaced hyphen, en-dash, or double hyphen as an em-dash (leave it if it's a range, a CLI argument, arithmetic, code, a term's definition, or reads more clearly than the alternatives)",
};

const HINT_MARKER = 'possible:';

function describeIssue(issue: IssueReport, width: number, maxWidth?: number): string {
  if (issue.type === 'overflow') {
    const limit = maxWidth ?? width;
    const name = maxWidth === undefined ? 'width' : 'maximum';

    return `line ${issue.line} is ${issue.length} columns, over the ${name} of ${limit}`;
  }

  const description = `line ${issue.line} ${ISSUE_DESCRIPTIONS[issue.type]}`;

  return issue.tier === 'hint' ? `${HINT_MARKER} ${description}` : description;
}

function describeIssues(paragraph: ParagraphReport, width: number, maxWidth?: number): string[] {
  return paragraph.issues.map((issue) => describeIssue(issue, width, maxWidth));
}

function describeComment(comment: CommentReport): string {
  const notes: string[] = [];

  for (const paragraph of comment.paragraphs) {
    const issues = describeIssues(paragraph, comment.width, comment.maxWidth);

    if (issues.length > 0 && !paragraph.reflowable) {
      const range = `lines ${paragraph.startLine}-${paragraph.endLine}`;

      issues.push(
        `${range} are kept as written (${paragraph.reason ?? 'layout'}), so the tool never rewraps them and any fix to them is yours`,
      );
    }

    notes.push(...issues);
  }

  const fence = comment.text.includes('```') ? '~~~~' : '```';

  return [
    `### ${comment.file}:${comment.startLine}-${comment.endLine} (width ${comment.width}${comment.maxWidth === undefined ? '' : `, maximum ${comment.maxWidth}`})`,
    '',
    ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ['- no measured issues; review the wording and flow']),
    '',
    `${fence}ts`,
    comment.text,
    fence,
  ].join('\n');
}

export function loadRules(agent: AgentConfig, configPath: string | undefined): string {
  let rules = DEFAULT_RULES;

  if (agent.rules) {
    const base = configPath ? path.dirname(configPath) : process.cwd();

    rules = readFileSync(path.resolve(base, agent.rules), 'utf8');
  }

  return agent.instructions ? `${rules.trimEnd()}\n\n## Instructions\n\n${agent.instructions.trim()}\n` : rules;
}

export function buildPrompt(options: {
  readonly rules: string;
  readonly root: string;
  readonly comments: readonly CommentReport[];
}): string {
  return [
    options.rules.trimEnd(),
    '',
    '## Task',
    '',
    `Fix the formatting of the comments below, following the rules above. Paths are relative to ${options.root}. Widths include indentation and the comment prefix. The notes under each comment come from the tool's measurements, so never count columns yourself.`,
    '',
    '- After you finish, the tool rewraps every prose paragraph as described under Layout, so a layout note on a prose paragraph needs no change from you. Change only the wording there, and leave its line breaks to the tool.',
    '- A note that a line may end with the start of a sentence, clause, or parenthetical is the exception. Only you can tell whether it does, so if it does, move those words to the start of the next line, unless the Layout rules let a long word stay.',
    '- A note that a line may split a parenthetical is the other exception. If the parenthetical reads better on one line, move the rest of it up to the end of that line yourself.',
    '- Parts kept as written are never rewrapped, and their notes say so. Fix those notes by hand, for example by breaking an overflowing prose line or by turning a long single-line comment into a multi-line one. Keep code, code spans, tables, box drawings, hard line breaks, and other intentional layout in them exactly as they are. If a note can only be fixed by changing those, leave it and say why in your reply.',
    `- Notes marked \`${HINT_MARKER}\` come from heuristics. If the rule doesn't actually apply, don't change anything for that note.`,
    '- Notes only point at places worth a look. Review each comment against the rules, and leave it as it is when it already follows them.',
    "- Edit only these comments. Don't change code, other comments, or other files.",
    '- When done, reply with one line per comment saying what you changed or why you left it.',
    '',
    ...options.comments.map((comment) => describeComment(comment)).flatMap((section) => [section, '']),
  ].join('\n');
}

export function shellQuote(value: string): string {
  return /^[\w./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function buildInvocation(options: {
  readonly agent: AgentConfig;
  readonly runner: AgentRunner;
  readonly prompt: string;
  readonly root: string;
}): AgentInvocation {
  const { agent, prompt, root } = options;
  const extra = agent.args ?? [];

  if (agent.command && agent.command.length > 0) {
    const [command, ...args] = agent.command;
    const hasPlaceholder = args.some((arg) => arg.includes('{prompt}'));

    return {
      command,
      // a function keeps the prompt as it is, while a string would expand `$&` or `$'` in a comment's text
      args: args.map((arg) => arg.replaceAll('{prompt}', () => prompt)),
      stdin: hasPlaceholder ? undefined : prompt,
    };
  }

  const model = agent.model ? ['--model', agent.model] : [];

  // the agent only reads and edits files, so it gets no shell
  if (options.runner === 'claude') {
    return {
      command: 'claude',
      args: [
        '-p',
        '--no-session-persistence',
        '--model',
        agent.model ?? DEFAULT_CLAUDE_MODEL,
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read',
        'Edit',
        'Grep',
        'Glob',
        ...extra,
      ],
      stdin: prompt,
    };
  }

  if (options.runner === 'codex') {
    return {
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--sandbox',
        'workspace-write',
        '--cd',
        root,
        '-c',
        'features.hooks=false',
        ...model,
        ...extra,
        '-',
      ],
      stdin: prompt,
    };
  }

  // cursor-agent has no flag to skip hooks, so the child relies on the `COMMENTS_HOOK_CHILD` guard
  return {
    command: 'cursor-agent',
    args: ['-p', '--trust', '--force', '--workspace', root, ...model, ...extra, prompt],
  };
}

export function describeAgent(agent: AgentConfig, runner: AgentRunner): string {
  if (agent.command && agent.command.length > 0) {
    return path.basename(agent.command[0]);
  }

  const model = runner === 'claude' ? (agent.model ?? DEFAULT_CLAUDE_MODEL) : agent.model;

  return model ? `${RUNNER_COMMANDS[runner]}, model ${model}` : RUNNER_COMMANDS[runner];
}

export function formatInvocation(invocation: AgentInvocation): string {
  const args = invocation.args.map((arg) => (arg.length > 80 ? '<prompt>' : shellQuote(arg)));

  return [invocation.command, ...args].join(' ');
}

export function runAgent(
  invocation: AgentInvocation,
  options: { root: string; timeout?: number },
): Promise<AgentResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.root,
      env: { ...process.env, [CHILD_ENV]: '1' },
    });

    const timers: NodeJS.Timeout[] = [];

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const settle = (result: Omit<AgentResult, 'output'>): void => {
      if (settled) {
        return;
      }

      settled = true;

      for (const timer of timers) {
        clearTimeout(timer);
      }

      // pipes that a process left behind by the agent still holds would keep this process from exiting
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();

      resolve({ ...result, output: `${stdout}${stderr}`.trim() });
    };

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (timedOut) {
        settle({ ok: false, error: `the agent timed out after ${timeout}s` });
      } else if (code === 0) {
        settle({ ok: true });
      } else {
        settle({ ok: false, error: `the agent exited with code ${code ?? signal}` });
      }
    };

    timers.push(
      setTimeout(() => {
        timedOut = true;

        child.kill();

        // an agent that ignores the signal is killed, and it counts as stopped even if that fails too
        timers.push(
          setTimeout(
            () => {
              child.kill('SIGKILL');
              finish(null, 'SIGKILL');
            },
            Math.min(KILL_GRACE_MS, timeout * 1000),
          ),
        );
      }, timeout * 1000),
    );

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle({
        ok: false,
        error: error.code === 'ENOENT' ? `\`${invocation.command}\` is not installed` : error.message,
      });
    });

    child.on('close', finish);

    // `close` waits for the pipes, so it may come long after the agent exited, or never
    child.on('exit', (code, signal) => {
      timers.push(
        setTimeout(() => {
          finish(code, signal);
        }, DRAIN_GRACE_MS),
      );
    });

    // an agent that exits without reading its stdin would otherwise crash the process with EPIPE
    child.stdin.on('error', () => {});
    child.stdin.end(invocation.stdin ?? '');
  });
}
