import { defineConfig } from 'tsup';

export default defineConfig({
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
  clean: true,
  splitting: false,
  treeshake: true,
});
