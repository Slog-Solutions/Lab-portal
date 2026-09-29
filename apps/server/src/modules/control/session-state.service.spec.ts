import { describe, expect, it, vi } from 'vitest';
import { SessionStateService } from './session-state.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MediaService } from '../media/media.service';
import type { LockService } from './lock.service';
import type { RoundTableFloorStore } from './round-table-floor.store';
import { findAnswerLeaks } from '../../common/answer-leak.spec-helper';

const STATION_ID = 'st1';

const BASE_ACTIVITY = {
  id: 'inst1',
  type: 'VOCABULARY_TEST',
  exerciseId: 'ex1',
  config: {
    shuffleItems: false,
    timeLimitSec: 600,
    revealMode: 'ON_TIME_EXPIRY',
    revealDetail: 'FULL_ANSWERS',
    items: [{ prompt: 'Capital of France?', answer: 'Paris', choices: ['Paris', 'Lyon', 'Nice'], explanation: 'Paris is the capital.' }],
  },
  dictionaryEnabled: null,
  startedAt: new Date('2026-09-29T10:00:00Z'),
  closesAt: new Date('2026-09-29T10:10:00Z'),
  closedAt: null,
  revealedAt: null,
  exercise: { title: 'Countries', config: { timeLimitSec: 600, revealMode: 'ON_TIME_EXPIRY', revealDetail: 'FULL_ANSWERS' } },
};

/** `groupOverride` merges shallowly onto the base group — `session` and
 * `activity` each replace wholesale when given, so a test only needs to
 * spell out the fields it's actually varying. */
function makeMember(groupOverride: { session?: Record<string, unknown>; activity?: Record<string, unknown> } = {}) {
  return {
    stationId: STATION_ID,
    groupId: 'g1',
    role: 'MEMBER',
    group: {
      sessionId: 'sess1',
      session: groupOverride.session ?? { seq: 3, state: 'RUNNING' },
      activity: groupOverride.activity ?? BASE_ACTIVITY,
    },
  };
}

function makeRig(groupOverride: { session?: Record<string, unknown>; activity?: Record<string, unknown> } = {}) {
  const prisma = {
    station: {
      findUnique: vi.fn().mockResolvedValue({ id: STATION_ID, enabled: true, seatNo: 5, hostname: 'PC-05', liveClass: null }),
    },
    sessionMember: { findFirst: vi.fn().mockResolvedValue(makeMember(groupOverride)), findMany: vi.fn().mockResolvedValue([]) },
  };
  const media = {
    ensureBroadcastRoom: vi.fn(),
    mintToken: vi.fn().mockResolvedValue('tok-broadcast'),
    mintMicGatedToken: vi.fn().mockResolvedValue('tok-mic-gated'),
    mintInterpretingToken: vi.fn().mockResolvedValue('tok-interp'),
    ensureRoom: vi.fn(),
  };
  const locks = { get: vi.fn().mockReturnValue(null) };
  const roundTableFloors = { ensure: vi.fn() };
  const svc = new SessionStateService(
    prisma as unknown as PrismaService,
    media as unknown as MediaService,
    locks as unknown as LockService,
    roundTableFloors as unknown as RoundTableFloorStore,
  );
  return { svc, prisma, media };
}

describe('SessionStateService.getDesiredState — timed vocabulary test snapshot', () => {
  it('GF-6: the pushed snapshot never carries the answer key or an explanation, for a live/launched test', async () => {
    const { svc } = makeRig();
    const snapshot = await svc.getDesiredState(STATION_ID);

    const leaks = findAnswerLeaks(snapshot, { answers: ['Paris'], explanations: ['Paris is the capital.'] });
    expect(leaks).toEqual([]);
    // The whitelist projection drops items/itemBankId entirely for a
    // VOCABULARY_TEST config — the questions themselves only ever travel
    // per-attempt through AttemptsService.prepareServe.
    expect(snapshot.activity?.config).toEqual({
      shuffleItems: false,
      timeLimitSec: 600,
      revealMode: 'ON_TIME_EXPIRY',
      revealDetail: 'FULL_ANSWERS',
    });
  });

  it('builds TimedTestState from the linked exercise/instance', async () => {
    const { svc } = makeRig();
    const snapshot = await svc.getDesiredState(STATION_ID);

    expect(snapshot.activity?.timedTest).toMatchObject({
      activityInstanceId: 'inst1',
      title: 'Countries',
      status: 'OPEN',
      closesAt: new Date('2026-09-29T10:10:00Z').getTime(),
      revealed: false,
      revealMode: 'ON_TIME_EXPIRY',
      revealDetail: 'FULL_ANSWERS',
    });
  });

  it('status is READY while the session is still ARMED (not yet started)', async () => {
    const { svc } = makeRig({ session: { seq: 1, state: 'ARMED' } });
    const snapshot = await svc.getDesiredState(STATION_ID);
    expect(snapshot.activity?.timedTest?.status).toBe('READY');
  });

  it('status is CLOSED once the instance has closedAt set, and revealed once revealedAt is set', async () => {
    const { svc } = makeRig({
      session: { seq: 5, state: 'RUNNING' },
      activity: { ...BASE_ACTIVITY, closedAt: new Date('2026-09-29T10:10:00Z'), revealedAt: new Date('2026-09-29T10:10:01Z') },
    });
    const snapshot = await svc.getDesiredState(STATION_ID);
    expect(snapshot.activity?.timedTest).toMatchObject({ status: 'CLOSED', revealed: true });
  });

  it('grants no group media room at all for a launched vocabulary test — no mic channel between test-takers', async () => {
    const { svc, media } = makeRig();
    const snapshot = await svc.getDesiredState(STATION_ID);

    expect(media.mintToken).toHaveBeenCalledTimes(1); // the broadcast room only
    expect(media.mintMicGatedToken).not.toHaveBeenCalled();
    expect(snapshot.media.rooms).toHaveLength(1);
  });

  it('a non-vocabulary-test activity (e.g. TELEPHONE) still gets its normal group room', async () => {
    const { svc, media } = makeRig({
      session: { seq: 1, state: 'RUNNING' },
      activity: {
        id: 'inst2',
        type: 'TELEPHONE',
        exerciseId: null,
        config: {},
        dictionaryEnabled: null,
        startedAt: null,
        closesAt: null,
        closedAt: null,
        revealedAt: null,
        exercise: null,
      },
    });
    const snapshot = await svc.getDesiredState(STATION_ID);
    expect(media.mintToken).toHaveBeenCalledTimes(2); // broadcast + group room
    expect(snapshot.media.rooms).toHaveLength(2);
    expect(snapshot.activity?.timedTest).toBeNull();
  });
});
