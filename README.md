# @d3lm/lint-preset

Opinionated dual-lint preset for JavaScript and TypeScript projects.

- **[Oxlint](https://oxc.rs/docs/guide/usage/linter)** runs the bulk of the rule set, including type-aware rules (via [`oxlint-tsgolint`](https://www.npmjs.com/package/oxlint-tsgolint))
- **[ESLint](https://eslint.org/)** layers on only the rules Oxlint can't run yet (e.g. `@typescript-eslint/naming-convention`, a handful of unicorn rules, and ESLint-core gaps)

## Installation

```bash
pnpm add -D @d3lm/lint-preset
```

The preset relies on a set of peer dependencies that it does not bundle. pnpm (with `auto-install-peers`, the default) pulls them in for you. With npm or yarn, install them explicitly:

```bash
pnpm add -D oxlint oxlint-tsgolint eslint typescript-eslint @typescript-eslint/eslint-plugin @stylistic/eslint-plugin eslint-config-prettier eslint-plugin-prettier eslint-plugin-oxlint eslint-plugin-jsdoc eslint-plugin-unicorn
```

React linting is opt-in. If you enable it for ESLint, also install the optional React Hooks peer:

```bash
pnpm add -D eslint-plugin-react-hooks
```

## Consumer Setup

### `oxlint.config.ts`

```ts
import { defineConfig } from 'oxlint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default defineConfig({
  extends: [oxlintConfig],
});
```

This pulls in the full rule set. Most rules run natively in Oxlint; a few plugins that Oxlint doesn't ship natively (custom `@d3lm` rules, `@stylistic`, `eslint-plugin-prettier`, `eslint-plugin-unicorn`, `eslint-plugin-jsdoc`) are wired in through Oxlint's `jsPlugins`. Either way you can toggle individual rules off in the same config.

React rules are disabled by default. Enable them by creating the shared config with `react: true`:

```ts
import { defineConfig } from 'oxlint';
import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';

export default defineConfig({
  extends: [createOxlintConfig({ react: true })],
});
```

`react` also accepts an object to toggle the two opt-in groups independently (both default to `true` when `react` is enabled):

```ts
createOxlintConfig({
  react: {
    fastRefresh: true, // react/only-export-components
    performance: true, // react-perf/* rules
  },
});
```

### `eslint.config.js`

```js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default eslintConfig({
  oxlintConfig,
  tsconfigRootDir: import.meta.dirname,
});
```

React Hooks linting is also opt-in:

```js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';

const oxlintConfig = createOxlintConfig({ react: true });

export default eslintConfig({
  oxlintConfig,
  react: true,
  tsconfigRootDir: import.meta.dirname,
});
```

The factory returns a `Linter.Config[]` you can spread, so you can append project-specific overrides:

```js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default [
  ...eslintConfig({
    oxlintConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    files: ['src/lib/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
];
```

Overrides spread _after_ `eslintConfig(...)` land after the Oxlint disabler, which is fine for turning rules **off**. To turn a rule back **on** that Oxlint owns, use `extraConfigs` instead (see below) so it isn't immediately disabled again — otherwise you'll get double-reporting from both linters.

### `package.json`

```json
{
  "scripts": {
    "lint": "oxlint && eslint",
    "lint:fix": "oxlint --fix && eslint --fix"
  }
}
```

Oxlint runs first (fast feedback on the majority of issues) and ESLint only reports what Oxlint didn't cover.

## ESLint Config Factory Options

```ts
eslintConfig({
  /**
   * Oxlint config object that eslint-plugin-oxlint reads to decide which
   * ESLint rules to turn off. Prefer this when your Oxlint config is created
   * in TypeScript.
   */
  oxlintConfig,

  /**
   * Path to a JSON/JSONC oxlint config file that eslint-plugin-oxlint reads
   * to decide which ESLint rules to turn off. Ignored when `oxlintConfig` is
   * provided.
   *
   * @default '.oxlintrc.json'
   */
  oxlintConfigPath: './.oxlintrc.json',

  /**
   * TypeScript project-service root. Usually `import.meta.dirname`.
   */
  tsconfigRootDir: import.meta.dirname,

  /**
   * Enable the ESLint-side React Hooks config. Pass `true`, or an object
   * `{ fastRefresh?, performance? }` mirroring the Oxlint factory. Requires
   * the optional `eslint-plugin-react-hooks` peer.
   *
   * @default false
   */
  react: true,

  /**
   * Files allowed to fall back to the default inferred project when they
   * aren't covered by the main tsconfig (e.g. top-level config files).
   *
   * @default ['*.config.ts', '*.config.mts', '*.config.cts', '*.config.js']
   */
  allowDefaultProject: ['*.config.ts', '*.config.js'],

  /**
   * Extra patterns to ignore. Layered on top of the built-in defaults unless
   * you opt out via `extendDefaultIgnores: false`.
   */
  ignores: ['generated/**'],

  /**
   * Whether to extend the built-in ignores with the ones passed in `ignores`.
   *
   * @default true
   */
  extendDefaultIgnores: true,

  /**
   * Flat-config entries layered *before* the Oxlint disabler, so custom
   * rules are still subject to the "Oxlint turns off last" ordering.
   */
  extraConfigs: [],

  /**
   * Optional rule-shape overrides forwarded to the TypeScript rule set,
   * including per-selector `namingConvention` exceptions.
   */
  namingConvention: {
    variable: { exceptions: ['MyGlobal'] },
  },

  /**
   * Tune unicorn's `name-replacements` (formerly `prevent-abbreviations`).
   * Extends the built-in allow list and replacements by default; set
   * `inheritAllowList` / `inheritReplacements` to false to replace them
   * outright.
   */
  preventAbbreviations: {
    allowList: ['args'],
    replacements: { props: false },
  },
});
```

## Oxlint Config Factory Options

`createOxlintConfig` accepts the React options shown above plus the same rule-shape overrides, scoped to the Oxlint rule set:

```ts
createOxlintConfig({
  /**
   * Toggle React rules (boolean or `{ fastRefresh?, performance? }`).
   *
   * @default false
   */
  react: true,

  /**
   * Overrides forwarded to the JS rules (e.g. `preventAbbreviations`).
   */
  jsRulesOxlint: {
    preventAbbreviations: { allowList: ['args'] },
  },

  /**
   * Overrides forwarded to the TS rules (e.g. `namingConvention`).
   */
  tsRulesOxlint: {
    namingConvention: { variable: { exceptions: ['MyGlobal'] } },
  },
});
```

## Comment Formatting (`comments`)

The preset ships a `comments` CLI that checks how comments in JavaScript and TypeScript files fit the configured width. Line breaks are left to the tool, except where only the meaning of the prose shows whether a line ends with the start of a sentence. `list`, `check`, and `wrap` never change files. By default, `agent` and the hook send an agent only the comments with hints, plus comments with issues in parts the tool never rewraps (see [Text Kept as Written](#text-kept-as-written)). That default is a cheap triage, not a full review of the language. With `--all` or `agent.scope: 'all'`, the agent reviews the wording of every comment in scope against its rules. The agent fixes the wording and moves the start of a sentence to the next line where a hint applies. Then the tool applies its exact rewrap to every comment in scope that still has a layout issue. The rewrap only changes whitespace in prose, like line breaks, runs of spaces, trailing spaces, and the indentation of continuation lines. It never changes a word, a punctuation character, a code span, or text kept as written, and it keeps the line endings of the file. Comments are found with a real parser, so strings, template literals, and regexes never produce false matches. Only block and JSDoc comments are checked, and line comments (`//`) are always left alone.

```bash
comments list                      # comments in uncommitted changes, with line lengths and issues
comments list src --suspicious     # only comments with issues or hints
comments check --base main         # print layout violations and exit with code 1 if any remain
comments list src/a.ts:42 --json   # the comment on line 42, with its rewrap suggestion
comments wrap src/a.ts:42          # print the exact rewrap of that comment to stdout
comments agent                     # hand suspicious comments to an agent, then verify the result
comments check --cwd ../other-app  # run as if started in another project
```

Without targets, only comments in uncommitted changes and untracked files are checked. `--base main` checks everything since the merge base with `main`, and `--repo` checks every file. `--whole-files` checks every comment in the changed files instead of only the comments on changed lines. Targets can be files, directories, `file:line`, or `file:start-end`. A comment that contains `comments-ignore` is skipped. A file with a syntax error is skipped as a whole and named in a warning, because the parser stops at the error and never sees the comments after it. JSX is read in `.js` files too.

With `--json`, each paragraph of a comment comes with its issues and a `suggestion` that holds the exact rewrapped lines. Code blocks, `@example`, tables, drawings, directives, and other [text kept as written](#text-kept-as-written) have no suggestion.

### Issues

Verdicts are layout issues that can be measured without reading the prose. They fail `comments check`:

- `overflow` means a measured prose line exceeds `maxWidth`
- `underfill` means a line ends early, so the paragraph needs more lines than it should
- `widow` means fewer than three words sit on the last line of a paragraph
- `unbalanced` means the lines are less even than in the suggested rewrap

Hints come from heuristics and can be false positives, because only the meaning of the prose shows whether the rule applies. A hint only sends a comment to the agent, which decides whether to change it. `check` only prints comments with verdicts, so a passing check stays quiet apart from its summary, even when hints remain after review. Use `list --suspicious` to inspect hints, which are marked with `(hint)` and never fail a check:

- `orphan` means a line ends with the first word of a sentence, or the first of two lines ends with the start of a sentence that fits on the second without making it longer than the first
- `em-dash` means the comment uses `—`
- `dash` means the comment uses `–` or `--` between words
- `semicolon` means the comment joins clauses with a semicolon
- `label-colon` means the comment uses the "label: explanation" pattern
- `emphasis` means the comment uses `*emphasis*` or `**bold**`
- `banner` means the comment is a divider made of repeated characters

A paragraph with an `orphan` hint is not reported as `unbalanced`, because the suggested rewrap moves the word that the hint is about, and the agent may rightly keep that word where it is. A line that ends early is still an `underfill`, whatever its last word is.

Hints are only checked in prose, never in code spans, code blocks, `@example`, or URLs. Rules that can't be measured, like writing complete sentences, are part of the agent's prompt (see `DEFAULT_RULES` in `src/comments/agent.ts`). The prompt treats the style rules as preferences, so the agent keeps punctuation that carries meaning or reads clearly, and never changes code, code spans, literals, patterns, or quotations.

### Text Kept as Written

The tool rewraps prose paragraphs, list items, and JSDoc tag descriptions. It keeps everything else exactly as written. Those parts have no suggestion, and any fix to them is manual. A paragraph is a run of lines that ends at an empty line, a code fence, a JSDoc tag, or a list item. Which checks run in a paragraph that is kept depends on its syntax, never on what the text means:

- Code gets no checks besides `banner`. This covers fenced and indented code blocks, the content of `@example`, `@default`, and `@defaultValue`, directives like `eslint-disable-next-line` or `@ts-expect-error` (only their exact names, so a line that starts with a package name like `eslint-config-prettier` stays prose), legal comments (`/*!`, `@license`, `@preserve`, and copyright notices, outside of code spans), and paragraphs that parse as JavaScript.
- A line that only looks like code gets `overflow` but no hints, since the hints would point at the code. The whole paragraph is kept as written. This covers lines that end with `{`, start with `}`, `]`, or `)`, declare a `const`, `let`, or `var`, or are an `import` or `export` with `from` or braces, as well as lines that end with `;` and hold code characters or no spaces. Prose can look like that too, like a line that starts with `import them from`, so the width is still measured.
- Layout syntax gets hints but no verdicts. It exempts the whole paragraph that holds one of these lines. That covers a line that starts with `|` and a Markdown table delimiter row like `--- | ---`, and any box-drawing character from `─` to `╿` (U+2500 to U+257F). It also covers a line that starts with four or more of the same character among `-=*#_~+/\` or ends with four or more among `-=*#_~` (but not a Markdown heading or a row of column underlines like `----  ----`), and aligned columns, meaning a gap of two or more spaces after which text continues at the same column on at least two lines.
- Text laid out by hand gets hints and `overflow`. This covers a Markdown hard line break, meaning a line that ends with two or more spaces or with a backslash and is followed by another line of the same paragraph. The whole paragraph is kept byte for byte, trailing spaces included. Like in Markdown, a backslash that another backslash escapes, as in `\\`, and trailing spaces on the last line of a paragraph don't break a line, so they're rewrapped like any other prose. It also covers text that may be laid out by hand: a Markdown heading, link definition, HTML tag, or `>` quote at the start of a line (prose can start a line like `<T> is the type` or `# of retries` too), a line with two or more `|`, arrows like `-->`, `<--`, or `→`, rules like `---`, `+--`, or `====`, and two or more lines that each start with a term and a dash or colon, like `width - the maximum width`. Single-line block comments and block comments without a `*` on each line are checked the same way. So is prose that the tool can't rewrap without changing how it reads or adding a line that is too long. That is a paragraph whose rewrap would itself read as code or layout, like one that would end with `;` on the same line as a `>`. It is also a paragraph with a code span or `{...}` group that continues on the next line and doesn't fit on one line, which is what a stray backtick or brace looks like too. JSDoc tags whose content isn't a description, like `@typedef`, are never rewrapped but still have to fit the width.

A comment with an issue in a part that is kept is handed to the agent, which can fix the prose by hand. To keep a free-form drawing that is wider than the width, put it in a code fence, or add `comments-ignore` to the comment.

### Configuration

`width` is the preferred line length; `maxWidth` is the hard maximum, including indentation and the comment prefix. The CLI defaults to a maximum of 120 columns (or `width`, if larger). A balanced parenthetical can extend a line past `width` when this keeps it together within `maxWidth`. In longer paragraphs, the wrapper balances all lines together and may split a parenthetical when that produces a better layout. A line never sticks out more than 15 columns past the line before it, like a full second line after a first line that the orphan rule keeps short, when up to two more lines avoid that. If the parenthetical cannot fit on a line of its own, it wraps normally. For example, `width: 80, maxWidth: 120` keeps `(JSDoc types, \`{@link ...}\`)` together in the example below:

```ts
/**
 * Splits prose into words, keeping backtick code spans and `{...}` groups (JSDoc types, `{@link ...}`)
 * intact so that they are never broken across lines.
 */
```

The separate `singleLineWidth` allowance is capped by `maxWidth`. Code and documented layout regions retain their exemptions. An indivisible token in measured prose that exceeds `maxWidth` is reported as overflow; the wrapper preserves it, so resolving that case requires changing the maximum or the comment manually. `tolerance` lets prose lines go up to that many columns past `width` when that saves a line in a paragraph of three or more lines, and it never goes past `maxWidth`. It defaults to 0. When `maxWidth` is omitted, `tolerance` also sets a legacy maximum of `width + tolerance`. Direct `analyzeSource` callers can omit `maxWidth` to retain the legacy width/tolerance behavior.

Like prettier, `comments` looks for a config file in the current directory and its parents, up to the repository root. The config can be a `comments.config.{ts,mts,js,mjs,cjs}`, `.commentsrc`, or `.commentsrc.json` file, or a `comments` key in `package.json`. All options are optional.

```ts
// comments.config.ts
import { defineConfig } from '@d3lm/lint-preset/comments';

export default defineConfig({
  // defaults to prettier's printWidth, or 80
  width: 100,
  maxWidth: 120,
  // prose lines may go this many columns past `width` when that saves a line
  tolerance: 0,
  // a comment that is one paragraph stays on one line up to this length, and wraps to `width` beyond it
  singleLineWidth: 120,
  avoidSentenceOrphans: true,
  // look for possible semicolons, em-dashes, dashes, label colons, emphasis, and banners as hints,
  // which only decides what the agent sees, since its rules apply to every comment it gets
  style: true,
  ignore: ['src/generated/**'],
  agent: {
    runner: 'claude', // or 'codex', 'cursor'
    model: 'haiku',
    timeout: 300, // seconds per agent
    batchSize: 20, // most comments per agent
    maxFiles: 10, // most files per agent
    maxAgents: 6, // most agents running at once
    scope: 'suspicious', // a triage, or 'all' to review the wording of every changed comment
    instructions: 'Rewording is allowed when a sentence reads awkwardly.',
  },
  hook: {
    mode: 'agent', // or 'report', 'off'
  },
});
```

Most options also have a command line flag that overrides the config file for a single run. See `comments --help` for the full list.

Comments are split across agents, because long prompts make an agent slower and less careful. All comments of a file go to the same agent, so two agents never edit the same file. Up to `maxAgents` agents run at once, and the rest wait their turn.

In a terminal, `comments agent` shows a live table of the agents while they run. Afterwards, it lists the comments that still have issues and lets you open each agent's reply. `--no-interactive` skips that list, so the command shows the agents while they run and exits when they're done. Without a terminal, for example in a hook or in CI, it prints plain progress lines and only prints the replies of agents that failed. `--verbose` prints every reply in both cases.

`agent.rules` points to a Markdown file that replaces the built-in formatting rules. `agent.command` runs any other agent CLI, like `['my-agent', '--prompt', '{prompt}']`. Without a `{prompt}` placeholder, the prompt goes to stdin.

### Agent Stop Hooks

`comments hook` runs when an agent finishes. It finds suspicious comments in the changed lines and hands them to a short-lived agent that doesn't keep a session. That catches what the hints point at, but it isn't a full review. With `--all` or `agent.scope: 'all'`, the agent reviews the wording of every changed comment, which costs an agent run whenever a comment changed. This repository uses `all`. Afterwards, the hook checks the edited comments again and reports any that still have verdicts. It also reports files where the agent changed code. In a git repository, it reports every other file that changed while the agents ran too, since an agent may only edit the comments it was given. That report can't tell an agent's edit from one of yours, so it never counts as a failure. When nothing is suspicious, no agent runs. The hook always exits successfully, so it never blocks the agent. That includes errors like an option it doesn't know, which it reports as a message instead.

Cursor (`.cursor/hooks.json`):

```json
{
  "version": 1,
  "hooks": {
    "stop": [{ "command": "node_modules/.bin/comments hook --host cursor", "timeout": 360 }]
  }
}
```

Claude Code (`.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/comments hook --host claude",
            "timeout": 360
          }
        ]
      }
    ]
  }
}
```

Codex (`.codex/hooks.json`, then trust it once via `/hooks`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$(git rev-parse --show-toplevel)\"/node_modules/.bin/comments hook --host codex",
            "timeout": 360,
            "statusMessage": "Formatting comments"
          }
        ]
      }
    ]
  }
}
```

The host stops a hook that runs longer than its timeout. Leave room for one agent's `timeout` (300 seconds by default), and raise it if your changes often need more than `maxAgents` agents, because each extra round of agents can take up to `timeout` again.

By default, each host uses its own CLI as the agent. Set `agent.runner` to always use the same one. Claude Code and Codex show the hook's summary in the UI, but Cursor only shows it in the hook output log.

## Development

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run test
```

The repo dogfoods the preset via `oxlint.config.ts` + `eslint.config.js` at the root, both pointing at `./dist/*` so `pnpm run lint` always lints against a fresh build.
