import { eslintConfig } from './dist/eslint.js';
import { oxlintConfig } from './dist/oxlint.js';

export default eslintConfig({
  tsconfigRootDir: import.meta.dirname,
  oxlintConfig,

  /**
   * These paths hold intentional rule violations used by the rule-ownership test, and source
   * snapshots that eval runs write verbatim. NAPI-RS generates the typings of the native addon.
   * `.scratch` is in `.gitignore`, which ESLint doesn't read, and its files are in no TypeScript
   * project, so each one would fail to parse.
   */
  ignores: ['src/configs/__tests__/fixtures/violations/**', 'native/*.d.ts', '.scratch/**'],
});
