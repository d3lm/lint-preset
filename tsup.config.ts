import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    eslint: 'src/eslint.ts',
    oxlint: 'src/oxlint.ts',
    rules: 'src/rules/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
});
