import { defineConfig } from 'vitest/config';

/**
 * Phase 5 finding, replacing an earlier same-pass attempt at `jest.config.ts`:
 * NestJS 12 genuinely ships `"type": "module"` (`@nestjs/common`'s own
 * package.json) — real ESM, not a CJS package with an ESM-flavored entry
 * point. Plain `node dist/main.js` works because Node 22+'s own
 * `require(esm)` interop handles it transparently (this repo pins
 * `node >=24.14.0`), but jest-runtime's module system doesn't get that
 * interop for free, and failed with a real, reproducible
 * "Cannot use import statement outside a module" the moment a test
 * imported anything that transitively pulls in `@nestjs/common`. vitest
 * (built on Vite's own ESM-native resolution) handles it with zero
 * extra configuration — verified by literally trying both.
 *
 * One real trade-off, stated rather than silently accepted: Vite/esbuild's
 * TS transform does NOT emit `emitDecoratorMetadata` (a documented esbuild
 * limitation — only tsc/SWC do), which is what NestJS's DI container reads
 * via `reflect-metadata` to auto-wire a class's constructor params. Every
 * test in this suite sidesteps that entirely by constructing services
 * directly (`new AttemptsService(fakePrisma, fakeAudit)`) rather than
 * booting a real `Test.createTestingModule()` — real DI-container
 * integration tests are a different, larger undertaking (the build plan's
 * own "integration tests... against a throwaway Postgres" item, still not
 * built) and would need a different setup than this one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
