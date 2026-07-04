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

## Development

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run test
```

The repo dogfoods the preset via `oxlint.config.ts` + `eslint.config.js` at the root, both pointing at `./dist/*` so `pnpm run lint` always lints against a fresh build.
