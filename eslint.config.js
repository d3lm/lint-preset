import { eslintConfig } from './dist/eslint.js';
import { oxlintConfig } from './dist/oxlint.js';

export default eslintConfig({
  tsconfigRootDir: import.meta.dirname,
  oxlintConfig,

  /**
   * These paths hold intentional rule violations used by the rule-ownership test, and source
   * snapshots that eval runs write verbatim.
   */
  ignores: ['src/configs/__tests__/fixtures/violations/**', 'evals/runs/**'],
});
