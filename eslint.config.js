import { eslintConfig } from './dist/eslint.js';
import { oxlintConfig } from './dist/oxlint.js';

export default eslintConfig({
  tsconfigRootDir: import.meta.dirname,
  oxlintConfig,
});
