import { defineConfig } from 'oxlint';
import { oxlintConfig } from './dist/oxlint.js';

export default defineConfig({
  extends: [oxlintConfig],
  /**
   * Ignores intentional rule violations used by the rule-ownership test, and source snapshots that
   * eval runs write verbatim.
   */
  ignorePatterns: ['src/configs/__tests__/fixtures/violations', 'evals/runs'],
});
