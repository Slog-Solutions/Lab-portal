export * from './types/index.js';
export * from './schemas/index.js';
export * from './text.js';
export * from './english-course-grading.js';
// Note: ./events and ./activities are intentionally NOT re-exported here.
// Import them via their own subpaths (`@lab/shared/events`,
// `@lab/shared/activities`) — events pulls in room-naming helpers that
// only the server/desktop need, and activities has a registration side
// effect that should happen explicitly, not on every `@lab/shared` import.
