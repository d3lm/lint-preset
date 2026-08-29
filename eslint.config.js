import { eslintConfig } from './dist/eslint.js';
import { oxlintConfig } from './dist/oxlint.js';

export default eslintConfig({
  tsconfigRootDir: import.meta.dirname,
  oxlintConfig,

  // intentional rule violations used by the rule-ownership test
  ignores: ['src/configs/__tests__/fixtures/violations/**'],
});
