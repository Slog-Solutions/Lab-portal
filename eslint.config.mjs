// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * One shared flat config for every workspace (Phase 5 — `lint` scripts
 * existed since Phase 0 in every workspace's package.json, but no eslint
 * config or dependency existed anywhere in the repo, so `npm run lint`
 * has never actually run). Deliberately not per-workspace configs: this
 * monorepo's tsconfig.base.json already draws that "one shared base"
 * line, and a lint ruleset diverging silently per package is exactly the
 * kind of drift that base file exists to prevent.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/release/**',
      '**/generated/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/desktop/out/**',
      'packages/native-bridge/prebuilds/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase is already full of deliberate
      // `// eslint-disable-next-line no-console` comments (server startup
      // banners, native-bridge/pronunciation degrade-honestly warnings) —
      // without this rule actually enabled, every one of those shows up
      // as an "unused disable directive" warning instead of doing what it
      // was clearly written to do.
      'no-console': 'warn',
      // Prisma/zod-heavy code legitimately reaches for `unknown`/`any` at
      // JSON boundaries (ActivityInstance.config, CommandEnvelope.payload)
      // more often than a typical app — the Activity Type Registry's own
      // design is "validate at the boundary", not "never touch unknown".
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Deliberately just these two rules, not the plugin's own
    // `recommended`/`recommended-latest` bundles — v7 unified both around
    // a much larger React-Compiler-oriented rule set (16 rules, including
    // `react-hooks/refs`: any `ref.current` read during render is an
    // error). This codebase's established
    // `someRef.current && <Child prop={someRef.current} />` idiom
    // (StudentConsole, predating this pass) trips that constantly without
    // being an actual bug — the ref is only ever set once in a
    // `useEffect`, and the surrounding component re-renders for unrelated
    // state reasons anyway. Auditing/refactoring against the full
    // Compiler rule set is a real, separate undertaking, not a side
    // effect of "make `npm run lint` work" — these two are exactly what
    // the codebase's existing `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comments already assumed exists.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
