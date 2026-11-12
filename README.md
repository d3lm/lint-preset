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

The preset ships a `comments` CLI that checks how comments in JavaScript, TypeScript, and Rust files fit the configured width. Line breaks are left to the tool, except where only the meaning of the prose shows whether a line ends with the start of a sentence. `list`, `check`, and `wrap` never change files. By default, `agent` and the hook send an agent only the comments with hints, plus comments with issues in parts the tool never rewraps (see [Text Kept as Written](#text-kept-as-written)). That default is a cheap triage, not a full review of the language. With `--failing` or `agent.scope: 'failing'`, the agent only gets the comments that fail `check`, and none that only have hints. With `--all` or `agent.scope: 'all'`, the agent reviews the wording of every comment in scope against its rules. The agent fixes the wording and moves the start of a sentence to the next line where a hint applies. Then the tool applies its exact rewrap to every comment in scope that still has a layout issue. The rewrap only changes whitespace in prose, like line breaks, runs of spaces, trailing spaces, and the indentation of continuation lines. It never changes a word, a punctuation character, a code span, or text kept as written, and it keeps the line endings of the file. Comments are found with a real parser, so strings, template literals, and regexes never produce false matches. Block and JSDoc comments get every check. Line comments (`//`) are never rewrapped, and they are only reported when a line is longer than `maxWidth` (see [Text Kept as Written](#text-kept-as-written)). Rust files get the same checks for their doc comments too (see [Rust](#rust)).

```bash
comments list                      # comments in uncommitted changes, with line lengths and issues
comments list src --suspicious     # only comments with issues or hints
comments check --base main         # print layout violations and exit with code 1 if any remain
comments list src/a.ts:42 --json   # the comment on line 42, with its rewrap suggestion
comments wrap src/a.ts:42          # print the exact rewrap of that comment to stdout
comments agent                     # hand suspicious comments to an agent, then verify the result
comments agent --failing           # hand only the comments that fail check to an agent
comments check --cwd ../other-app  # run as if started in another project
```

Without targets, only comments in uncommitted changes and untracked files are checked. `--base main` checks everything since the merge base with `main`, and `--repo` checks every file. `--whole-files` checks every comment in the changed files instead of only the comments on changed lines. Targets can be files, directories, `file:line`, or `file:start-end`. A comment that contains `comments-ignore` is skipped. A file with a syntax error is skipped as a whole and named in a warning, because the parser stops at the error and never sees the comments after it. JSX is read in `.js` files too.

With `--json`, each paragraph of a comment comes with its issues and a `suggestion` that holds the exact rewrapped lines. Code blocks, `@example`, tables, drawings, directives, and other [text kept as written](#text-kept-as-written) have no suggestion.

### Issues

Verdicts are layout issues that can be measured without reading the prose. They fail `comments check`:

- `overflow` means a measured prose line exceeds `maxWidth`
- `underfill` means a line ends early, so the paragraph needs more lines than it should
- `widow` means fewer than three words sit on the last line of a paragraph
- `unbalanced` means the lines are less even than in the suggested rewrap, or a line ends inside a link, code span, or `{...}` group (see [Text That Stays on One Line](#text-that-stays-on-one-line))

Hints come from heuristics and can be false positives, because only the meaning of the prose shows whether the rule applies. A hint only sends a comment to the agent, which decides whether to change it. `check` only prints comments with verdicts, so a passing check stays quiet apart from its summary, even when hints remain after review. Use `list --suspicious` to inspect hints, which are marked with `(hint)` and never fail a check:

- `orphan` means a line ends with the first word of a sentence, a line ends with the first two words of a sentence that the suggested rewrap moves to the next line, or the first of two lines ends with the start of a sentence that fits on the second without making it longer than the first
- `split-parenthetical` means a line ends inside a parenthetical that the suggested rewrap keeps on one line within `maxWidth`
- `em-dash` means the comment uses `—`
- `dash` means the comment uses `–` or `--` between words
- `semicolon` means the comment joins clauses with a semicolon
- `label-colon` means the comment uses the "label: explanation" pattern
- `emphasis` means the comment uses `*emphasis*` or `**bold**`
- `banner` means the comment is a divider made of repeated characters

A paragraph with an `orphan` hint is not reported as `unbalanced` when that word is all that sets it apart from the suggested rewrap, because the agent may rightly keep the word where it is. This holds when the paragraph matches the rewrap that allows orphans. A paragraph that differs from that rewrap too, like a line that ends with the hinted word while more words fit on it, is still `unbalanced`. A line that ends early is still an `underfill`, whatever its last word is.

In the same way, a paragraph that splits a parenthetical is not reported as `unbalanced` when the split is all that sets it apart from the suggested rewrap, because the split can read as well and keep the line closer to `width`. This holds when the lines before the split match the rewrap and the lines after it match the rewrap of the text after the split. Otherwise the paragraph is still `unbalanced`.

With a `tolerance`, a paragraph has no `underfill`, `widow`, or `unbalanced` verdict when it already has the layout that the tool produces for a wider `width`, up to `width` plus `tolerance`. Its suggestion then keeps the lines as they are. With `width: 100` and `tolerance: 5`, a paragraph that is laid out the way the tool lays it out for a width of 105 passes. A paragraph that only has hints keeps them, and a line past `maxWidth` is still an `overflow`.

Hints are only checked in prose, never in code spans, code blocks, `@example`, or URLs. Rules that can't be measured, like writing complete sentences, are part of the agent's prompt (see `DEFAULT_RULES` in `src/comments/agent.ts`). The prompt treats the style rules as preferences, so the agent keeps punctuation that carries meaning or reads clearly, and never changes code, code spans, literals, patterns, or quotations.

### Text That Stays on One Line

The rewrap never breaks a line inside a code span, a `{...}` group like a JSDoc type or `{@link ...}`, or a Markdown link. A link is the text in brackets with the target right after it, which is `[text](target)` with an optional title, `[text][label]`, or `[text]` on its own. Brackets pair up like in Markdown, so a bracket in a code span or after a backslash doesn't count. Only the syntax counts, because only the renderer knows whether `[text]` resolves to anything, like an intra-doc link in Rust. A link that continues on the next line can't be followed in an editor. rust-analyzer, for one, only resolves an intra-doc link that sits on one line of a `///` comment.

Each of them is one word for the layout. A line that ends inside one is `unbalanced`, whatever else holds for the paragraph, so `check` fails and the rewrap joins it. The only exception is a code span in a Rust file, which keeps its paragraph as written (see [Rust](#rust)). One that is longer than `maxWidth` allows stays intact. On a single line it is an `overflow`. When it continues on the next line, joining it would add a line that is too long, so its paragraph is kept as written (`unbreakable text across lines`), and only shortening it or moving its target to a link reference definition fixes it.

### Text Kept as Written

The tool rewraps prose paragraphs, list items, and JSDoc tag descriptions. Everything else is kept exactly as written and has no suggestion, so the agent or you have to fix it by hand:

- Code gets no checks besides `banner`. This covers code blocks, `@example`, `@default`, and `@defaultValue`, tool directives like `eslint-disable-next-line` or `@ts-expect-error`, legal comments (`/*!`, `@license`, `@preserve`, and copyright notices), and paragraphs that parse as JavaScript, or as Rust in a Rust file.
- Layout syntax gets hints but no verdicts, in the whole paragraph around it. This covers Markdown tables (a line that starts with `|`, or a delimiter row like `--- | ---`), box-drawing characters (U+2500 to U+257F), a line that starts with four or more of the same character among `-=*#_~+/\` or ends with four or more among `-=*#_~` (except Markdown headings and column underlines like `----  ----`), and aligned columns (a gap of two or more spaces after which text continues at the same column on at least two lines).
- Text that only looks like code or hand layout keeps its line breaks but still gets `overflow`, since prose can look like that too. Lines that look like code, such as ones that end with `{` or `;` or start with `import` (or with `let`, `use`, or an attribute like `#[derive(Debug)]` in Rust files), get no hints. Hand layout, such as Markdown hard line breaks, headings, quotes, arrows, and `term - description` lists, still gets hints.
- Line comments (`//`) on their own lines get `overflow` and nothing else, so a line comment that fits `maxWidth` is never reported. A run of them on consecutive lines with the same indentation is one comment, and an empty `//` line separates its paragraphs. Code and layout syntax in them are exempt like above, and so is each line with a tool directive. A line comment after code on the same line is never checked. The agent fixes an overflowing line comment by shortening it, or by turning it into a multi-line block comment (`/** */` in JavaScript and TypeScript, `/* */` in Rust), which the tool then rewraps.

To keep a drawing that is wider than the width, put it in a code fence or add `comments-ignore` to the comment.

### Rust

In `.rs` files, the tool checks plain block comments (`/* */`) and every kind of doc comment: outer and inner line doc comments (`///` and `//!`) and outer and inner block doc comments (`/** */` and `/*! */`). A run of `///` or `//!` lines with the same indentation is one comment, and each line holds a prefix like the ` * ` of a block comment, so a run is checked and rewrapped like a JSDoc comment with the same text. The run ends at an empty line, at another marker, or at a line with other indentation. Other line comments, including `////`, and block comments that rustdoc doesn't read as docs, like `/***` and `/**/`, are plain comments, like in rustc. Plain line comments are only checked for lines past `maxWidth`, like `//` comments in JavaScript.

Rust comments are found with `rustc`'s own lexer (`ra_ap_rustc_lexer`, built into a native addon with [NAPI-RS](https://napi.rs)), so raw strings, byte and C strings, characters, lifetimes, nested block comments, a shebang, and the frontmatter of a cargo script never produce false matches. The lexer never stops early. A source with a token that never ends, like an unterminated block comment or string, is skipped and named like a file with a syntax error, because that token holds every comment after it. Like rustc, the tool reads a `/*` inside a block comment as the start of a nested comment, even inside a code span.

Doc comments are Markdown, and the checks above already treat them that way. Code blocks are doctests, so they are never touched, including hidden lines that start with `#`. Headings like `# Examples` and link reference definitions like ``[`Foo`]: crate::Foo`` are kept as written. Intra-doc links like ``[`count_provider_reads`]``, ``[`permissions`](crate::permissions)``, ``[the parser][`Parser`]``, or `[HashMap<K, V>]` always stay on one line, with their text and their target (see [Text That Stays on One Line](#text-that-stays-on-one-line)). A link that continues on the next line is joined, which rustdoc resolves the same way, since it reads runs of whitespace in a link as one space. A code span that continues on the next line is different. rustdoc shows the spaces at the start of the next line inside the code span, and how many there are depends on the indentation of every line of the item's docs, so a paragraph with such a code span is kept as written in Rust (`code span across lines`), and the tool never splits a code span itself. Rust has no JSDoc tags, so a line that starts with `@` is prose. Paragraphs are code when they parse as Rust statements, items, fields, match arms, or associated items (with `ra_ap_syntax`, the parser of rust-analyzer). A `/*!` or `//!` comment is an inner doc comment, not a legal comment, so only `@license`, `@preserve`, and copyright notices make a Rust comment legal.

The code fingerprint that makes sure only comments changed compares the tokens of a Rust file, without whitespace and comments. Each run of doc comments counts as one token of its style, since doc comments are attributes of the item after them. So rewording or rewrapping a doc comment is no code change, but turning `///` into `//`, into `//!`, or into `/** */`, or moving it to another item, is.

The width of a Rust file defaults to `comment_width` from the nearest `rustfmt.toml` or `.rustfmt.toml`, which is 80 when it's not set, like in rustfmt, and tabs count as `tab_spaces` columns (4 by default). Prettier's config never applies to Rust files. `width` in the `comments` config still overrides both.

The package ships the addon for macOS on arm64 and x64, and for Linux with glibc 2.17 or later on x64 and arm64. CI builds each of these `targets` from `native/napi.json` on its own runner and tests it there, and publishing fails when one of them is missing. In this repository, the addon is built with `pnpm run build:native`, which `build` and `test` run too, and needs a Rust toolchain. Without an addon for the platform, like on Windows or on Linux with musl, Rust files fail with a message that says how to build it, and JavaScript and TypeScript files work as before. To skip Rust files, leave `.rs` out of `extensions`, or pass `--ignore '**/*.rs'` for a single run.

`native/verify/verify.mjs` verifies that rewrapping Rust comments never changes code or what rustdoc renders. It rewraps the fixture crate in `native/verify/fixture` with the CLI and the comments of any `--corpus` directory, like `~/.cargo/registry/src/<index>`, with the library, at several widths. Then it checks that the code fingerprint and the words of every comment stay the same, that a second rewrap changes nothing, that every paragraph keeps its kind, and that no prose has a verdict left. The only exception is an overflow from a word that is longer than the maximum on its own, or from a line that holds no more text than the longest line of its paragraph did before, since a rewrap never adds a line like that. For the fixture, it also checks that the crate compiles and that its doctests pass. Last, it compares the JSON output of nightly rustdoc before and after: every item must render the same Markdown events, resolve the same intra-doc links, and have the same doc text apart from whitespace. It also finds the links of every item with pulldown-cmark, so the check doesn't rely on what the tool takes for a link. A link that was on one line must never continue on the next line after the rewrap, and no link of the fixture may continue on the next line at all, as long as each of them fits on a line.

```bash
pnpm run build
node native/verify/verify.mjs --corpus ~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f
```

### Configuration

`width` is the preferred line length, and `maxWidth` is the hard maximum, including indentation and the comment prefix. The CLI defaults `maxWidth` to 120, or to `width` if that is larger. The wrapper may go past `width`, up to `maxWidth`, to keep a parenthetical on one line. `tolerance` (default 0) lets lines in paragraphs of three or more lines go that many columns past `width` when that saves a line. `check` also accepts a paragraph that already has the layout for a wider `width`, up to `width` plus `tolerance`, while the tool itself still wraps to `width`. A comment that is one paragraph stays on one line up to `singleLineWidth` plus `tolerance`, capped by `maxWidth`. A word, code span, or link longer than `maxWidth` is never split and is reported as `overflow`.

Like prettier, `comments` looks for a config file in the current directory and its parents, up to the repository root. The config can be a `comments.config.{ts,mts,js,mjs,cjs}`, `.commentsrc`, or `.commentsrc.json` file, or a `comments` key in `package.json`. All options are optional.

```ts
// comments.config.ts
import { defineConfig } from '@d3lm/lint-preset/comments';

export default defineConfig({
  // defaults to prettier's printWidth, or 80, and to rustfmt's comment_width in Rust files
  width: 100,
  maxWidth: 120,
  tolerance: 0,
  singleLineWidth: 120,
  avoidSentenceOrphans: true,
  // report the style hints, like `em-dash` and `semicolon`
  style: true,
  // only these files, unless `ignore` skips them
  include: ['src/**'],
  ignore: ['src/generated/**'],
  agent: {
    runner: 'claude', // or 'codex', 'cursor'
    model: 'haiku',
    timeout: 300, // seconds per agent
    batchSize: 20, // most comments per agent
    maxFiles: 10, // most files per agent
    maxAgents: 6, // most agents running at once
    scope: 'suspicious', // a triage, 'failing' for only comments that fail check, or 'all' for every changed comment
    instructions: 'Rewording is allowed when a sentence reads awkwardly.',
  },
  hook: {
    mode: 'agent', // or 'report', 'off'
  },
});
```

Most options also have a command line flag that overrides the config file for a single run. See `comments --help` for the full list.

`include` and `ignore` take globs relative to the repository root, and apply to every scope, including files and directories passed as targets. A file is checked when it has one of the `extensions`, matches an `include` glob (or `include` is empty), and matches no `ignore` glob. `--include` replaces `include` from the config file, and `--ignore` adds to `ignore`, so `comments check --repo --include '**/*.rs'` checks only Rust files, and `--ignore '**/*.rs'` skips them.

Comments are split across several agents, and all comments of a file go to the same agent. In a terminal, `comments agent` shows the agents while they run, then lists the comments that still have issues. `--no-interactive` skips that list, and `--verbose` prints every agent's reply.

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
