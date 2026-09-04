import { defineConfig } from 'oxlint';
import { oxlintConfig } from './dist/oxlint.js';

export default defineConfig({
  extends: [oxlintConfig],
  // intentional rule violations used by the rule-ownership test
  ignorePatterns: ['src/configs/__tests__/fixtures/violations'],
});
