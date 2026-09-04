import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    eslint: 'src/eslint.ts',
    oxlint: 'src/oxlint.ts',
    rules: 'src/rules/index.ts',
  },
  format: ['esm', 'cjs'],
  /**
   * Shim `import.meta.url` in the CJS build; `src/eslint.ts` and
   * `src/oxlint.ts` rely on it for `createRequire`/plugin path
   * resolution.
   */
  shims: true,
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
});
