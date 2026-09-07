import type { z } from 'zod';
import { ActivityType } from '../types/enums.js';

/**
 * Activity Type Registry (design doc "Activity Type Registry" / Phase 2-3).
 *
 * Each activity in Annexure-I (model imitation, round table, telephone,
 * content exercise, vocabulary test, pronunciation, conference
 * interpreting, presentation recording, self-study) is one module that
 * implements this descriptor. Adding an activity is one file plus two UI
 * components — never a schema migration, because config/response are
 * opaque JSONB validated at runtime against the activity's own schema.
 *
 * `playerComponent`/`authoringComponent` are string keys, not React
 * component references — this package has no React dependency. apps/web
 * resolves the key to a component via its own registry
 * (features/activities/registry.tsx) so @lab/shared stays UI-framework-free
 * and is safely importable from apps/server and apps/desktop too.
 */
export interface ActivityDescriptor<TConfig = unknown, TResponse = unknown> {
  id: ActivityType;
  label: string;
  /** Validates ActivityInstance.config / DesiredStationState.activity.config. */
  configSchema: z.ZodType<TConfig>;
  /** Validates a single student's submitted response/result payload. */
  responseSchema: z.ZodType<TResponse>;
  /** Component key resolved by apps/web's UI-side activity registry. */
  playerComponent: string;
  authoringComponent: string;
  /** Declares what the runtime must provision before this activity can run. */
  realtimeRequirements: {
    mediaRoom: 'broadcast' | 'group' | 'interpreting' | 'telephone' | 'none';
    needsRecording: boolean;
    needsChairman: boolean;
  };
}

const registry = new Map<ActivityType, ActivityDescriptor>();

export function registerActivity<TConfig, TResponse>(
  descriptor: ActivityDescriptor<TConfig, TResponse>,
): void {
  if (registry.has(descriptor.id)) {
    throw new Error(`Activity type already registered: ${descriptor.id}`);
  }
  registry.set(descriptor.id, descriptor as ActivityDescriptor);
}

export function getActivity(id: ActivityType): ActivityDescriptor {
  const descriptor = registry.get(id);
  if (!descriptor) {
    throw new Error(`Unknown activity type: ${id}. Is it registered in @lab/shared/activities?`);
  }
  return descriptor;
}

export function listActivities(): ActivityDescriptor[] {
  return Array.from(registry.values());
}

export function hasActivity(id: ActivityType): boolean {
  return registry.has(id);
}
