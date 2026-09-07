import { defineConfig } from 'tsup';

/**
 * Bundles main + preload into single CJS files, inlining workspace deps
 * (design doc §1.5 "electron-builder × npm workspaces" — npm hoisting
 * breaks electron-builder's dependency collection otherwise). `electron`
 * itself stays external — it's provided by the Electron runtime, never
 * bundled.
 */
export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
  },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  external: ['electron'],
  noExternal: [/^@lab\//],
  sourcemap: true,
  clean: true,
  splitting: false,
});
