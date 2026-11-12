import { defineConfig } from '@d3lm/lint-preset/comments';

export default defineConfig({
  width: 100,
  maxWidth: 120,
  singleLineWidth: 100,
  ignore: ['src/configs/__tests__/fixtures/**', 'native/verify/fixture/**'],
  agent: {
    runner: 'claude',
    model: 'haiku',
    scope: 'all',
  },
});
