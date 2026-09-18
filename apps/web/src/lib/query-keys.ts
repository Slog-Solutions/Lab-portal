/** Centralized TanStack Query keys — Phase 1/2 inlined array literals
 * per call site and had already duplicated one key by the time Phase 3
 * started (['stations','status-board'] in two files); this is the fix. */
export const queryKeys = {
  stationsStatusBoard: ['stations', 'status-board'] as const,
  batches: ['batches'] as const,
  sessions: ['sessions'] as const,
  adminBatches: ['admin', 'batches'] as const,
  adminBatch: (id: string) => ['admin', 'batches', id] as const,
  adminBatchStudents: (id: string) => ['admin', 'batches', id, 'students'] as const,
  users: (role?: string) => ['users', role ?? 'all'] as const,
  myEnrollments: ['my-enrollments'] as const,
  mediaAssets: ['media-assets'] as const,
  mediaAsset: (id: string) => ['media-assets', id] as const,
  contentPackages: ['content-packages'] as const,
  exercises: ['exercises'] as const,
  exercise: (id: string) => ['exercises', id] as const,
  exerciseItems: (id: string) => ['exercises', id, 'items'] as const,
  gradebookAttempts: (filter: Record<string, string | undefined>) => ['gradebook', 'attempts', filter] as const,
  gradebookAttempt: (id: string) => ['gradebook', 'attempts', id] as const,
  gradebookAssignments: (filter: Record<string, string | undefined>) => ['gradebook', 'assignments', filter] as const,
  pronunciationStatus: ['pronunciation', 'status'] as const,
  pronunciationAttempts: (exerciseId: string) => ['pronunciation', 'attempts', exerciseId] as const,
  studyModules: ['study-modules'] as const,
};
