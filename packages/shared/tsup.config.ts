import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: {
    index: 'src/index.ts',
    'events/index': 'src/events/index.ts',
    'schemas/index': 'src/schemas/index.ts',
    'activities/index': 'src/activities/index.ts',
    'agent/index': 'src/agent/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // Only clean on a one-shot build. `tsup --watch` (turbo's `dev` task)
  // otherwise wipes dist/ the instant it starts, racing any dependent
  // package's own one-shot dev build (@lab/desktop's `npm run build &&
  // electron .`) that turbo has already unblocked because @lab/shared's
  // `build` task (which `dev` depends on via turbo.json's `^build`) just
  // finished — that ordering guarantee says nothing about this watcher's
  // own startup clean, which was the actual race.
  clean: !options.watch,
  splitting: false,
  treeshake: true,
}));
