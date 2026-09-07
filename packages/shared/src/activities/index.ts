export * from './registry.js';
// Registers every Annexure-I activity as a side effect of import — callers
// only need `import '@lab/shared/activities'` (or any export from it) once,
// typically at server/app bootstrap and at the web activity registry.
import './definitions.js';
