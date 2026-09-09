import { defineConfig } from 'tsup';

/**
 * Bundles main + preload into single CJS files, inlining workspace deps
 * (design doc §1.5 "electron-builder × npm workspaces" — npm hoisting
 * breaks electron-builder's dependency collection otherwise). `electron`
 * itself stays external — it's provided by the Electron runtime, never
 * bundled.
 *
 * `@lab/native-bridge` MUST also stay external: it does a conditional
 * `require('../prebuilds/win32-x64/lab_native.node')` inside a try/catch
 * (intentional — that file doesn't exist yet, see build plan "week one
 * spike"). If esbuild inlines that call it tries to resolve the path at
 * BUILD time and fails hard, rather than at runtime where the try/catch
 * can actually catch it. Left external, Node's own require() resolves it
 * lazily at runtime as designed. `@nut-tree-fork/nut-js` (native-bridge's
 * real dependency, verified: moves the actual OS cursor) rides along
 * unbundled for the same reason — its prebuilt libnut.node binary can't
 * be inlined either.
 */
export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
  },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  external: ['electron', '@lab/native-bridge'],
  noExternal: [/^@lab\/(?!native-bridge)/],
  sourcemap: true,
  clean: true,
  splitting: false,
});
