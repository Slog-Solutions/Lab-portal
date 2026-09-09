import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getActivity, hasActivity, listActivities, registerActivity } from './registry.js';
import { ActivityType } from '../types/enums.js';
// Importing the public activities entry point (not just ./registry.js)
// triggers definitions.ts's registration side effect for every real
// Annexure-I activity — see that file's own doc comment on why one
// import is enough. This is the whole reason the registry is worth
// testing at all: packages/shared's own Phase 3 recon found it had been
// written but never actually exercised against real data until
// exercises.service.ts started calling getActivity() for real.
import './index.js';

describe('Activity Type Registry', () => {
  it('registers every Annexure-I activity type named in the enum', () => {
    for (const id of Object.values(ActivityType)) {
      expect(hasActivity(id)).toBe(true);
    }
  });

  it('listActivities() returns exactly the registered set, no more/less', () => {
    const ids = listActivities().map((d) => d.id);
    expect(new Set(ids)).toEqual(new Set(Object.values(ActivityType)));
  });

  it('getActivity() throws a descriptive error for an unregistered id', () => {
    expect(() => getActivity('NOT_A_REAL_ACTIVITY' as ActivityType)).toThrow(/Unknown activity type/);
  });

  it('registerActivity() refuses to register the same id twice', () => {
    // MODEL_IMITATION is already registered by definitions.ts (imported
    // above) — this proves the guard fires against a real collision, not
    // just a fabricated one.
    expect(() =>
      registerActivity({
        id: ActivityType.MODEL_IMITATION,
        label: 'duplicate',
        configSchema: z.unknown(),
        responseSchema: z.unknown(),
        playerComponent: 'x',
        authoringComponent: 'y',
        realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
      }),
    ).toThrow(/already registered/);
  });

  it('every registered descriptor has a real, callable zod configSchema and responseSchema', () => {
    for (const descriptor of listActivities()) {
      expect(typeof descriptor.configSchema.safeParse).toBe('function');
      expect(typeof descriptor.responseSchema.safeParse).toBe('function');
    }
  });

  it('an empty config object is rejected for activities with a required field (not all of them: TELEPHONE\'s are all optional/defaulted)', () => {
    for (const id of [
      ActivityType.MODEL_IMITATION,
      ActivityType.ROUND_TABLE,
      ActivityType.CONTENT_EXERCISE,
      ActivityType.VOCABULARY_TEST,
      ActivityType.PRONUNCIATION,
      ActivityType.CONFERENCE_INTERPRETING,
      ActivityType.PRESENTATION_RECORDING,
      ActivityType.SELF_STUDY,
    ]) {
      expect(getActivity(id).configSchema.safeParse({}).success, `${id} unexpectedly accepted {}`).toBe(false);
    }
  });
});
