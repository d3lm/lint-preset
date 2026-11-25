# @d3lm/lint-preset

Opinionated Oxlint + ESLint preset for JavaScript and TypeScript projects, with a `comments` CLI for keeping prose comments tidy.

- **[Oxlint](https://oxc.rs/docs/guide/usage/linter)** runs the bulk of the rule set, including type-aware rules (via [`oxlint-tsgolint`](https://www.npmjs.com/package/oxlint-tsgolint)) and JS plugins (`@d3lm`, `@stylistic`, `prettier`, and the unicorn and jsdoc rules that Oxlint doesn't port, under the aliases `unicornx` and `jsdocx`).
- **[ESLint](https://eslint.org/)** layers on only the rules Oxlint can't run yet (such as `@typescript-eslint/naming-convention`, `unicorn/expiring-todo-comments`, and a few ESLint-core rules).

## Installation

```bash
pnpm add -D @d3lm/lint-preset
```

pnpm installs peer dependencies automatically. With npm or yarn, install them explicitly, along with `prettier` and `typescript`, which those peers require:

```bash
npm install -D oxlint oxlint-tsgolint eslint typescript-eslint @typescript-eslint/eslint-plugin @stylistic/eslint-plugin eslint-config-prettier eslint-plugin-prettier eslint-plugin-oxlint eslint-plugin-jsdoc eslint-plugin-unicorn prettier typescript
```

If you enable React linting, also install the optional React Hooks peer, which no package manager installs automatically:

```bash
pnpm add -D eslint-plugin-react-hooks
```

## Quick Start

### 1. `oxlint.config.ts`

```ts
import { defineConfig } from 'oxlint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default defineConfig({
  extends: [oxlintConfig],
});
```

### 2. `eslint.config.js`

```js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default eslintConfig({
  oxlintConfig,
  tsconfigRootDir: import.meta.dirname,
});
```

### 3. `package.json`

```json
{
  "scripts": {
    "lint": "oxlint && eslint",
    "lint:fix": "oxlint --fix && eslint --fix"
  }
}
```

## Configuration

### React

React rules are opt-in. Enable them on both configs via `createOxlintConfig` and `eslintConfig`:

```ts
// oxlint.config.ts
import { defineConfig } from 'oxlint';
import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';

export default defineConfig({
  extends: [createOxlintConfig({ react: true })],
});
```

```js
// eslint.config.js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';

export default eslintConfig({
  oxlintConfig: createOxlintConfig({ react: true }),
  react: true,
  tsconfigRootDir: import.meta.dirname,
});
```

You can also toggle React rule groups individually (both default to `true` when `react` is enabled):

```ts
createOxlintConfig({
  react: {
    // react/only-export-components
    fastRefresh: true,

    // react-perf/*
    performance: true,
  },
});
```

### Customizing Rules & Overrides

**Oxlint** uses standard `defineConfig` overrides and accepts rule-shape options via `createOxlintConfig`. TypeScript files get their rules from `tsRulesOxlint`, so pass an option to both `jsRulesOxlint` and `tsRulesOxlint` to apply it to every file:

```ts
import { defineConfig } from 'oxlint';
import { createOxlintConfig } from '@d3lm/lint-preset/oxlint';

const preventAbbreviations = { allowList: ['args'] };

export default defineConfig({
  extends: [
    createOxlintConfig({
      jsRulesOxlint: { preventAbbreviations },
      tsRulesOxlint: { preventAbbreviations },
    }),
  ],
  ignorePatterns: ['generated/**'],
  rules: {
    'no-console': 'off',
  },
});
```

**ESLint** returns a flat `Linter.Config[]` you can spread. Spread overrides _after_ `eslintConfig(...)` to disable rules, or pass `extraConfigs` to add rules _before_ `eslint-plugin-oxlint` disables overlapping ones:

```js
import { eslintConfig } from '@d3lm/lint-preset/eslint';
import { oxlintConfig } from '@d3lm/lint-preset/oxlint';

export default [
  ...eslintConfig({
    oxlintConfig,
    tsconfigRootDir: import.meta.dirname,
    ignores: ['generated/**'],
    namingConvention: {
      variable: { exceptions: ['MyGlobal'] },
    },
  }),
  {
    files: ['src/lib/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
];
```

### Options Reference

#### `eslintConfig(options)`

| Option                 | Default                    | Description                                                                                                                                              |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxlintConfig`         | —                          | Oxlint config object used to disable overlapping ESLint rules.                                                                                           |
| `oxlintConfigPath`     | `'.oxlintrc.json'`         | Path to a JSON/JSONC Oxlint config (ignored when `oxlintConfig` is set).                                                                                 |
| `tsconfigRootDir`      | —                          | TypeScript project-service root (usually `import.meta.dirname`).                                                                                         |
| `react`                | `false`                    | Any truthy value enables `eslint-plugin-react-hooks`. Takes the same value as the Oxlint option, but `fastRefresh` and `performance` only affect Oxlint. |
| `allowDefaultProject`  | `*.config.{ts,mts,cts,js}` | Files allowed to fall back to the default TS project when not in `tsconfig.json`. The default is one glob per extension.                                 |
| `ignores`              | `[]`                       | Extra ignore patterns, appended to defaults (`dist/**`, `node_modules/**`, `coverage/**`).                                                               |
| `extendDefaultIgnores` | `true`                     | Set `false` to replace built-in ignores with `ignores`.                                                                                                  |
| `extraConfigs`         | `[]`                       | Flat configs layered _before_ the Oxlint disabler.                                                                                                       |
| `namingConvention`     | —                          | Per-selector exceptions/format overrides for `@typescript-eslint/naming-convention`.                                                                     |

#### `createOxlintConfig(options)`

| Option          | Default | Description                                                                  |
| --------------- | ------- | ---------------------------------------------------------------------------- |
| `react`         | `false` | Enables React plugins/rules (`boolean` or `{ fastRefresh?, performance? }`). |
| `jsRulesOxlint` | —       | `{ preventAbbreviations }` for JavaScript files.                             |
| `tsRulesOxlint` | —       | `{ preventAbbreviations }` for TypeScript files.                             |

`preventAbbreviations` configures `unicornx/name-replacements` (formerly unicorn's `prevent-abbreviations`). Its `allowList` and `replacements` extend the built-in ones, unless you set `inheritAllowList` or `inheritReplacements` to `false`. The abbreviation rule only runs in Oxlint, and `naming-convention` only runs in ESLint, so pass each option to the factory that runs its rule.

## Comment Formatting (`comments`)

The preset ships a `comments` CLI that checks and wraps prose comments in JavaScript, TypeScript, and Rust files. `list`, `check`, and `wrap` never change files. `agent` and `hook` hand comments to a coding agent to fix their wording, then rewrap every comment that still has a layout issue. The rewrap only changes whitespace, never words, punctuation, or code.

### Commands

```bash
comments list                      # inspect comments in uncommitted changes
comments list src --suspicious     # only comments with verdicts or hints
comments check --base main         # fail (exit 1) on layout violations since main
comments wrap src/a.ts:42          # print the exact rewrap of one comment
comments agent                     # fix flagged comments with an agent, then rewrap
comments agent --all               # review wording of every comment in scope
comments agent -p "Reword freely"  # append extra instructions for this run
```

By default, commands check comments on uncommitted lines (including untracked files). Pass targets (`file`, `dir`, `file:line`, `file:start-end`) or scope flags (`--base <ref>`, `--repo`, `--whole-files`, `--include`, `--ignore`). Add `comments-ignore` inside any comment to skip it. Run `comments --help` for all flags.

### Configuration

`comments` searches upward from the working directory, up to the repository root, for `comments.config.{ts,mts,js,mjs,cjs}`, `.commentsrc`, `.commentsrc.json`, or a `"comments"` field in `package.json`. All fields are optional:

```ts
// comments.config.ts
import { defineConfig } from '@d3lm/lint-preset/comments';

export default defineConfig({
  // Defaults to Prettier's printWidth (or 80), and rustfmt's comment_width in .rs files. Setting it overrides both
  width: 100,
  // Hard limit. Defaults to 120, or to `width + tolerance` when only `tolerance` is set
  maxWidth: 120,
  tolerance: 0, // extra columns past `width` allowed to save a line or balance edges
  singleLineWidth: 120, // keep one-paragraph comments on one line up to this width
  avoidSentenceOrphans: true,
  style: true, // flag style hints (em-dash, semicolon, emphasis, banners, etc.)
  include: ['src/**'],
  ignore: ['src/generated/**'],
  agent: {
    runner: 'claude', // 'claude' | 'codex' | 'cursor' (or use `command` for custom CLIs)
    model: 'haiku',
    scope: 'suspicious', // 'suspicious' (default triage) | 'failing' | 'all'
    timeout: 300, // seconds per agent
    batchSize: 20, // max comments per agent
    maxFiles: 10, // max files per agent
    maxAgents: 6, // max concurrent agents
    instructions: 'Rewording is allowed when a sentence reads awkwardly.',
    // rules: './comment-rules.md', // replace built-in agent rules
  },
  hook: {
    mode: 'agent', // 'agent' | 'report' | 'off'
  },
});
```

Most options have matching CLI flags that override the config file for one run.

### Issues & Hints

- **Verdicts** (fail `comments check`): `overflow` (exceeds `maxWidth`), `underfill` (line ends too early), `widow` (fewer than 3 words on the last line), `unbalanced` (uneven lines or a broken link/code span/`{...}` group), and `wide` (a line ends more than `tolerance` columns past `width` and past every line of the suggested rewrap, or the last line sticks out past the lines before it).
- **Hints** (never fail `check`; only select comments for `agent` and `hook` in the default `suspicious` scope): `orphan`, `split-parenthetical`, `em-dash`, `dash`, `semicolon`, `label-colon`, `emphasis`, and `banner`. Inspect them with `comments list --suspicious`.

The rewrap never breaks a line inside a code span, a `{...}` group, or a Markdown link, so a line that ends inside one is `unbalanced`. One that is longer than `maxWidth` stays intact and is reported as `overflow`.

### Text Kept as Written

Only prose paragraphs, list items, and JSDoc/rustdoc tag descriptions are rewrapped. Everything else keeps its line breaks:

- **Code** (code blocks, `@example`, `@default`, tool directives like `eslint-disable-next-line`, legal comments, and paragraphs that parse as code) gets no checks except `banner`.
- **Layout syntax** (Markdown tables, box-drawing characters, divider lines, and aligned columns) gets hints but no verdicts.
- **Text that only looks like code or hand layout** keeps its line breaks, but still gets `overflow`.
- **Line comments (`//`)** are never rewrapped and only get `overflow`.

To preserve a wide ASCII diagram, put it in a code fence or add `comments-ignore` to the comment.

**Rust support:** `.rs` doc comments (`///`, `//!`, `/** */`, `/*! */`) and block comments are parsed with rustc's lexer, using a prebuilt native addon (macOS arm64/x64 and Linux glibc x64/arm64). On other platforms, Rust files fail with a message that explains how to build the addon (`pnpm run build:native`, which needs a Rust toolchain). Exclude `.rs` via `ignore` or `extensions` if you don't need Rust support.

### Agent Stop Hooks

`comments hook` runs automatically when your coding agent finishes a turn. It checks comments in changed lines, runs a short-lived agent to clean up flagged comments, rewraps prose, and reports any remaining issues without ever blocking the session.

By default, each host uses its own CLI as the runner (override with `agent.runner`). Make sure the hook timeout is larger than `agent.timeout` (300s default), and raise it if your changes often need more than `maxAgents` agents, since each extra round of agents can take up to `agent.timeout` again. Claude Code and Codex show the hook's summary in the UI, but Cursor only writes it to the hook output log.

**Cursor** (`.cursor/hooks.json`):

```json
{
  "version": 1,
  "hooks": {
    "stop": [{ "command": "node_modules/.bin/comments hook --host cursor", "timeout": 360 }]
  }
}
```

**Claude Code** (`.claude/settings.json`):

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

**Codex** (`.codex/hooks.json`, then trust it once via `/hooks`):

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

## Development

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run test
```

`build` and `test` also build the native addon for Rust comments, so they need a Rust toolchain. `pnpm run check` type-checks without emitting.

The repo dogfoods itself via `oxlint.config.ts` and `eslint.config.js` pointing at `./dist/*`, and `pnpm run lint` builds first so it always lints a fresh build.

`native/verify/verify.mjs` checks that rewrapping Rust comments never changes code or what rustdoc renders. It runs on a fixture crate and, optionally, on a `--corpus` of real crates. It needs `pnpm run build` first, and a nightly toolchain for rustdoc's JSON output:

```bash
node native/verify/verify.mjs --corpus ~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f
```
