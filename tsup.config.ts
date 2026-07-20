import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Declarations come from tsc (`npm run build:types`), not tsup: tsup bundles
  // rollup-plugin-dts built against the TypeScript 5.7 compiler API, which
  // crashes on TypeScript 7.
  dts: false,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
