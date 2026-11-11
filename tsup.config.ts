import { defineConfig } from 'tsup';

/**
 * The builds run concurrently, so each one cleans only its own output.
 */
const CLI_DIRECTORY = 'bin';

export default defineConfig([
  {
    entry: {
      eslint: 'src/eslint.ts',
      oxlint: 'src/oxlint.ts',
      rules: 'src/rules/index.ts',
      comments: 'src/comments/index.ts',
    },
    format: ['esm', 'cjs'],
    /**
     * Shim `import.meta.url` in the CJS build. `src/eslint.ts` and `src/oxlint.ts` rely on it for
     * `createRequire`/plugin path resolution.
     */
    shims: true,
    dts: true,
    clean: [`!${CLI_DIRECTORY}/**`],
    splitting: true,
    sourcemap: true,
  },
  {
    entry: { comments: 'src/comments/bin.ts' },
    outDir: `dist/${CLI_DIRECTORY}`,
    format: ['esm'],
    clean: true,
    sourcemap: true,
  },
]);
