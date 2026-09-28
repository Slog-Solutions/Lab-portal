import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zRoundTableConfig } from '@lab/shared/activities';
import { RoundTableService, CHAIRMAN_OFFLINE_GRACE_MS } from './round-table.service';
import type { RoundTableGroupState } from '../control/round-table-floor.store';

const T0 = new Date('2026-09-21T10:00:00Z').getTime();
const teacher = { sub: 'teach1', role: 'TEACHER', serviceNumber: 'TCH-9' } as never;

function makeGroup(id: string, extra: Record<string, unknown> = {}): RoundTableGroupState {
  return {
    groupId: id,
    sessionId: 's1',
    instanceId: `ai-${id}`,
    config: zRoundTableConfig.parse({ topic: 'Trade', ...extra }),
    members: [
      { stationId: `${id}-chair`, seatNo: 2 },
      { stationId: `${id}-m1`, seatNo: 3 },
      { stationId: `${id}-m2`, seatNo: 4 },
    ],
    startedAtMs: T0,
    floor: {
      groupId: id,
      chairmanStationId: `${id}-chair`,
      speakerStationId: null,
      queue: [],
      teacher: 'absent',
      turnStartedAt: null,
      seq: 0,
      phase: 'RUNNING',
      chairmanOffline: false,
    },
  };
}

/** A rig of fakes around the real RoundTableService (this repo's spec style:
 * plain objects of vi.fn(), the service constructed directly). LiveKit is a
 * mutable participant list so a test can assert who ended up allowed to publish. */
function makeRig(extra: Record<string, unknown> = {}) {
  const g1 = makeGroup('g1', extra);
  const g2 = makeGroup('g2', extra);
  const groups: Record<string, RoundTableGroupState> = { g1, g2 };
  const store = {
    ensure: vi.fn(async (id: string) => groups[id] ?? null),
    get: vi.fn((id: string) => groups[id]),
    all: vi.fn(() => Object.values(groups)),
    refresh: vi.fn(async (id: string) => groups[id] ?? null),
    persist: vi.fn(),
    drop: vi.fn(),
  };
  const emitted: Array<{ room: string; event: string; payload: any }> = [];
  const gateway = {
    server: { to: (room: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }) }) },
    pushSnapshot: vi.fn(),
  };
  const participants: Array<{ identity: string; permission: { canPublish: boolean }; tracks: unknown[] }> = [];
  for (const g of Object.values(groups)) {
    for (const m of g.members) participants.push({ identity: `st:${m.stationId}`, permission: { canPublish: false }, tracks: [] });
  }
  const media = {
    listParticipants: vi.fn(async () => participants),
    setMicPermission: vi.fn(async (_room: string, identity: string, allowed: boolean) => {
      const p = participants.find((x) => x.identity === identity);
      if (p) p.permission.canPublish = allowed;
    }),
    removeParticipant: vi.fn(async () => undefined),
    muteMicTracks: vi.fn(async () => undefined),
    mintMicGatedToken: vi.fn(async () => 'jwt'),
  };
  const online = new Set<string>(Object.values(groups).flatMap((g) => g.members.map((m) => m.stationId)));
  let presenceCb: (id: string, on: boolean) => void = () => undefined;
  const presence = {
    onChange: vi.fn((cb: (id: string, on: boolean) => void) => {
      presenceCb = cb;
      return () => undefined;
    }),
    isOnline: vi.fn((id: string) => online.has(id)),
  };
  const turns: any[] = [];
  const prisma = {
    roundTableTurn: { create: vi.fn(async ({ data }: any) => turns.push(data)), findMany: vi.fn(async () => []) },
    station: { findUnique: vi.fn(async () => ({ currentUserId: 'user-1' })) },
    sessionMember: { updateMany: vi.fn(async () => ({})) },
    sessionGroup: { findMany: vi.fn(async () => [{ id: 'g1' }]), findUnique: vi.fn(async () => null) },
    recording: { findMany: vi.fn(async () => []) },
    classSession: { findUnique: vi.fn(async () => ({ batchId: 'b1' })) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const batchAccess = { assertCanUseBatch: vi.fn(async () => undefined) };
  const sessionState = { getDesiredState: vi.fn(async () => ({})) };
  const svc = new RoundTableService(
    prisma as never, media as never, gateway as never, presence as never,
    sessionState as never, store as never, audit as never, batchAccess as never,
  );
  svc.onModuleInit();
  return {
    svc, g1, g2, media, prisma, presence, gateway, emitted, turns, online, audit, batchAccess, sessionState, participants,
    setOnline: (id: string, on: boolean) => {
      if (on) online.add(id); else online.delete(id);
      presenceCb(id, on);
    },
    canPublish: (identity: string) => participants.find((p) => p.identity === identity)?.permission.canPublish,
  };
}

const ref = { sessionId: 's1', groupId: 'g1' };

describe('RoundTableService: mic requests (RT-7)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('queues requests in order and rejects duplicates', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m1', ref);
    await r.svc.requestMic('g1-m2', ref);
    expect(r.g1.floor.queue).toEqual(['g1-m1', 'g1-m2']);
    await expect(r.svc.requestMic('g1-m1', ref)).rejects.toThrow(/already in the queue/);
    expect(r.g1.floor.queue).toEqual(['g1-m1', 'g1-m2']);
  });

  it('rejects the chairman, the current speaker, non-members and a paused discussion', async () => {
    const r = makeRig();
    await expect(r.svc.requestMic('g1-chair', ref)).rejects.toThrow(/does not need/);
    await expect(r.svc.requestMic('g2-m1', ref)).rejects.toThrow(/not in this group/);
    r.g1.floor.speakerStationId = 'g1-m1';
    await expect(r.svc.requestMic('g1-m1', ref)).rejects.toThrow(/already have the floor/);
    r.g1.floor.phase = 'PAUSED';
    await expect(r.svc.requestMic('g1-m2', ref)).rejects.toThrow(/not running/);
  });

  it('rejects requests when the queue is turned off', async () => {
    const r = makeRig({ micRequestQueueEnabled: false });
    await expect(r.svc.requestMic('g1-m1', ref)).rejects.toThrow(/requests are off/);
  });

  it('cancelRequest removes a queued seat and bumps seq', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m1', ref);
    const before = r.g1.floor.seq;
    await r.svc.cancelRequest('g1-m1', ref);
    expect(r.g1.floor.queue).toEqual([]);
    expect(r.g1.floor.seq).toBeGreaterThan(before);
  });
});

describe('RoundTableService: the server owns the floor (RT-3)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('grant lets exactly the chairman and the speaker publish; revoke silences the speaker', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m1', ref);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    expect(r.g1.floor.speakerStationId).toBe('g1-m1');
    expect(r.g1.floor.queue).toEqual([]);
    expect(r.canPublish('st:g1-chair')).toBe(true);
    expect(r.canPublish('st:g1-m1')).toBe(true);
    expect(r.canPublish('st:g1-m2')).toBe(false);
    await r.svc.revokeFloor('g1-chair', ref);
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.canPublish('st:g1-m1')).toBe(false);
    expect(r.canPublish('st:g1-chair')).toBe(true);
  });

  it('only diff-applies: an unchanged participant is never touched', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    r.media.setMicPermission.mockClear();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m2');
    const touched = r.media.setMicPermission.mock.calls.map((c) => `${c[1]}:${c[2]}`).sort();
    expect(touched).toEqual(['st:g1-m1:false', 'st:g1-m2:true']);
  });

  it('SECURITY: a non-chairman grant is rejected and changes nothing', async () => {
    const r = makeRig();
    await expect(r.svc.grantFloor('g1-m2', ref, 'g1-m2')).rejects.toThrow(/Only the chairman/);
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.media.setMicPermission).not.toHaveBeenCalled();
  });

  it('cannot grant to a non-member or to the chairman', async () => {
    const r = makeRig();
    await expect(r.svc.grantFloor('g1-chair', ref, 'g2-m1')).rejects.toThrow(/not in this group/);
    await expect(r.svc.grantFloor('g1-chair', ref, 'g1-chair')).rejects.toThrow(/already has the floor/);
  });

  it('only the current speaker can yield', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    await expect(r.svc.yieldFloor('g1-m2', ref)).rejects.toThrow(/do not have the floor/);
    await r.svc.yieldFloor('g1-m1', ref);
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.canPublish('st:g1-m1')).toBe(false);
  });

  it('emits every change to the group and to dashboards with a rising seq', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m1', ref);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    const groupEvents = r.emitted.filter((e) => e.room === 'grp:g1' && e.event === 'rt:floor');
    const dashEvents = r.emitted.filter((e) => e.room === 'rt:s1' && e.event === 'rt:floor');
    expect(groupEvents).toHaveLength(2);
    expect(dashEvents).toHaveLength(2);
    expect(groupEvents[1]!.payload.seq).toBeGreaterThan(groupEvents[0]!.payload.seq);
  });
});

describe('RoundTableService: speaking turns come from the server clock (RT-10)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('records a member turn keyed by stationId with server-relative times', async () => {
    const r = makeRig();
    vi.setSystemTime(T0 + 10_000);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    vi.setSystemTime(T0 + 25_000);
    await r.svc.revokeFloor('g1-chair', ref);
    expect(r.turns).toEqual([
      { activityInstanceId: 'ai-g1', stationId: 'g1-m1', studentId: 'user-1', teacherUserId: null, role: 'MEMBER', startMs: 10_000, endMs: 25_000 },
    ]);
  });

  it('a seat with no student still records a turn (studentId null)', async () => {
    const r = makeRig();
    r.prisma.station.findUnique.mockResolvedValue({ currentUserId: null } as never);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    vi.setSystemTime(T0 + 5_000);
    await r.svc.yieldFloor('g1-m1', ref);
    expect(r.turns[0]).toMatchObject({ stationId: 'g1-m1', studentId: null });
  });

  it('handing the floor to someone else closes the previous turn', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    vi.setSystemTime(T0 + 4_000);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m2');
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0]).toMatchObject({ stationId: 'g1-m1', startMs: 0, endMs: 4_000 });
    expect(r.g1.floor.speakerStationId).toBe('g1-m2');
  });

  it('records the chairman from voice activity, merging pauses shorter than 1.5s', async () => {
    const r = makeRig();
    await r.svc.chairSpeaking('g1-chair', ref, true);
    vi.setSystemTime(T0 + 3_000);
    await r.svc.chairSpeaking('g1-chair', ref, false);
    vi.setSystemTime(T0 + 4_000); // resumes within 1.5s -> same turn
    await r.svc.chairSpeaking('g1-chair', ref, true);
    vi.setSystemTime(T0 + 6_000);
    await r.svc.chairSpeaking('g1-chair', ref, false);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0]).toMatchObject({ role: 'CHAIRMAN', stationId: 'g1-chair', startMs: 0, endMs: 6_000 });
  });

  it("records who was signed in at the chairman's seat, like a member's turn", async () => {
    const r = makeRig();
    await r.svc.chairSpeaking('g1-chair', ref, true);
    vi.setSystemTime(T0 + 3_000);
    await r.svc.chairSpeaking('g1-chair', ref, false);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(r.turns[0]).toMatchObject({ role: 'CHAIRMAN', stationId: 'g1-chair', studentId: 'user-1' });
  });

  it('drops chairman noise shorter than 1.5s and ignores non-chairman speech reports', async () => {
    const r = makeRig();
    await r.svc.chairSpeaking('g1-chair', ref, true);
    vi.setSystemTime(T0 + 500);
    await r.svc.chairSpeaking('g1-chair', ref, false);
    await vi.advanceTimersByTimeAsync(1_600);
    await r.svc.chairSpeaking('g1-m1', ref, true); // not the chairman: ignored
    await vi.advanceTimersByTimeAsync(5_000);
    await r.svc.chairSpeaking('g1-m1', ref, false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(r.turns).toEqual([]);
  });
});

describe('RoundTableService: disconnects (resilience)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('a speaker that drops loses the floor immediately and the turn is recorded', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    vi.setSystemTime(T0 + 7_000);
    r.setOnline('g1-m1', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.turns[0]).toMatchObject({ stationId: 'g1-m1', endMs: 7_000 });
  });

  it('a queued member that drops is removed from the queue', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m1', ref);
    r.setOnline('g1-m1', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.g1.floor.queue).toEqual([]);
  });

  it('manual chair offline > 20s: floor freezes, teacher is alerted, and it recovers on return', async () => {
    const r = makeRig();
    r.setOnline('g1-chair', false);
    await vi.advanceTimersByTimeAsync(CHAIRMAN_OFFLINE_GRACE_MS - 1_000);
    expect(r.g1.floor.chairmanOffline).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(r.g1.floor.chairmanOffline).toBe(true);
    expect(r.emitted.some((e) => e.event === 'rt:alert' && e.payload.kind === 'chairman_offline')).toBe(true);
    await expect(r.svc.requestMic('g1-m1', ref)).rejects.toThrow(/disconnected/);
    r.setOnline('g1-chair', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.g1.floor.chairmanOffline).toBe(false);
  });

  it('a chair that returns inside 20s is never frozen', async () => {
    const r = makeRig();
    r.setOnline('g1-chair', false);
    await vi.advanceTimersByTimeAsync(10_000);
    r.setOnline('g1-chair', true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.g1.floor.chairmanOffline).toBe(false);
  });

  it('automatic chair offline > 20s: the next online member is promoted and the teacher notified', async () => {
    const r = makeRig({ chairmanAssignment: 'automatic' });
    r.setOnline('g1-chair', false);
    await vi.advanceTimersByTimeAsync(CHAIRMAN_OFFLINE_GRACE_MS + 500);
    expect(r.g1.floor.chairmanStationId).toBe('g1-m1');
    expect(r.g1.floor.chairmanOffline).toBe(false);
    expect(r.prisma.sessionMember.updateMany).toHaveBeenCalledTimes(2);
    expect(r.emitted.some((e) => e.event === 'rt:alert' && e.payload.kind === 'chairman_promoted' && e.payload.stationId === 'g1-m1')).toBe(true);
    expect(r.canPublish('st:g1-m1')).toBe(true);
    expect(r.gateway.pushSnapshot).toHaveBeenCalled();
  });
});

describe('RoundTableService: pause and end', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('pause ends the turn and silences everyone', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    vi.setSystemTime(T0 + 3_000);
    r.g1.floor.phase = 'PAUSED';
    await r.svc.onSessionState('s1', 'PAUSED');
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.canPublish('st:g1-chair')).toBe(false);
    expect(r.canPublish('st:g1-m1')).toBe(false);
    expect(r.turns[0]).toMatchObject({ stationId: 'g1-m1', endMs: 3_000 });
  });

  it('end closes open turns (including a teacher who is still speaking) and drops the floor', async () => {
    const r = makeRig();
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    await r.svc.participate(teacher, 's1', 'g1');
    vi.setSystemTime(T0 + 9_000);
    await r.svc.onSessionState('s1', 'ENDED');
    expect(r.turns.map((t) => t.role).sort()).toEqual(['MEMBER', 'TEACHER']);
    expect(r.turns.every((t) => t.endMs === 9_000)).toBe(true);
    expect(r.gateway.pushSnapshot).not.toHaveBeenCalled();
  });
});

describe('RoundTableService: teacher listen-in and participate (RT-8, RT-9)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  const teacherPeer = (r: ReturnType<typeof makeRig>) => {
    r.participants.push({ identity: 'st:teacher:teach1', permission: { canPublish: false }, tracks: [] });
  };

  it('listen mints a subscribe-only, NON-hidden token and shows "listening" to the group', async () => {
    const r = makeRig();
    const join = await r.svc.listen(teacher, 's1', 'g1');
    expect(join.identity).toBe('st:teacher:teach1');
    expect(join.room).toBe('sess:s1:grp:g1');
    expect(r.media.mintMicGatedToken).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: 'teacher:teach1', canPublishMic: false, role: 'TEACHER' }),
    );
    expect(r.g1.floor.teacher).toBe('listening');
    const last = r.emitted.filter((e) => e.room === 'grp:g1' && e.event === 'rt:floor').at(-1)!;
    expect(last.payload.teacher).toBe('listening');
    expect(r.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'round_table.listen' }));
  });

  it('participate lets the teacher publish and records a TEACHER turn on leave', async () => {
    const r = makeRig();
    teacherPeer(r);
    await r.svc.listen(teacher, 's1', 'g1');
    expect(r.canPublish('st:teacher:teach1')).toBe(false);
    vi.setSystemTime(T0 + 2_000);
    await r.svc.participate(teacher, 's1', 'g1');
    expect(r.g1.floor.teacher).toBe('speaking');
    expect(r.canPublish('st:teacher:teach1')).toBe(true);
    vi.setSystemTime(T0 + 8_000);
    await r.svc.leave(teacher, 's1', 'g1');
    expect(r.g1.floor.teacher).toBe('absent');
    expect(r.canPublish('st:teacher:teach1')).toBe(false);
    expect(r.media.removeParticipant).toHaveBeenCalledWith('sess:s1:grp:g1', 'st:teacher:teach1');
    expect(r.turns).toEqual([
      { activityInstanceId: 'ai-g1', stationId: null, studentId: null, teacherUserId: 'teach1', role: 'TEACHER', startMs: 2_000, endMs: 8_000 },
    ]);
  });

  it('switching groups leaves the previous one first', async () => {
    const r = makeRig();
    await r.svc.listen(teacher, 's1', 'g1');
    await r.svc.listen(teacher, 's1', 'g2');
    expect(r.g1.floor.teacher).toBe('absent');
    expect(r.g2.floor.teacher).toBe('listening');
    expect(r.media.removeParticipant).toHaveBeenCalledWith('sess:s1:grp:g1', 'st:teacher:teach1');
  });

  it('a second instructor cannot take a group another instructor is in', async () => {
    const r = makeRig();
    await r.svc.listen(teacher, 's1', 'g1');
    const other = { sub: 'teach2', role: 'TEACHER', serviceNumber: 'TCH-2' } as never;
    await expect(r.svc.listen(other, 's1', 'g1')).rejects.toThrow(/Another instructor/);
  });

  it('checks the batch before doing anything, and cannot participate before the start', async () => {
    const r = makeRig();
    r.batchAccess.assertCanUseBatch.mockRejectedValueOnce(new Error('You are not assigned to this batch'));
    await expect(r.svc.listen(teacher, 's1', 'g1')).rejects.toThrow(/not assigned/);
    expect(r.g1.floor.teacher).toBe('absent');
    r.g1.floor.phase = 'ARMED';
    await expect(r.svc.participate(teacher, 's1', 'g1')).rejects.toThrow(/not started/);
  });

  it('a group of another session is refused', async () => {
    const r = makeRig();
    await expect(r.svc.listen(teacher, 'other-session', 'g1')).rejects.toThrow(/not running/);
  });

  it('the reconcile loop drops a teacher whose tab closed (absent from LiveKit for 15s)', async () => {
    const r = makeRig();
    await r.svc.listen(teacher, 's1', 'g1'); // never appears in the room
    await vi.advanceTimersByTimeAsync(5_000 * 3 + 100);
    expect(r.g1.floor.teacher).toBe('absent');
  });

  it('the reconcile loop repairs a member who somehow holds an open mic', async () => {
    const r = makeRig();
    r.participants.find((p) => p.identity === 'st:g1-m2')!.permission.canPublish = true;
    await vi.advanceTimersByTimeAsync(5_100);
    expect(r.canPublish('st:g1-m2')).toBe(false);
  });
});

describe('RoundTableService: chairman changes and rotation', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('teacher reassigns the chair: roles saved, old chair loses the mic, new chair gets it', async () => {
    const r = makeRig();
    await r.svc.setChairman(teacher, 's1', 'g1', 'g1-m2');
    expect(r.g1.floor.chairmanStationId).toBe('g1-m2');
    expect(r.prisma.sessionMember.updateMany).toHaveBeenCalledWith({ where: { groupId: 'g1', stationId: 'g1-chair' }, data: { role: 'MEMBER' } });
    expect(r.prisma.sessionMember.updateMany).toHaveBeenCalledWith({ where: { groupId: 'g1', stationId: 'g1-m2' }, data: { role: 'CHAIRMAN' } });
    expect(r.canPublish('st:g1-m2')).toBe(true);
    expect(r.canPublish('st:g1-chair')).toBe(false);
    expect(r.gateway.pushSnapshot).toHaveBeenCalledTimes(3);
  });

  it('cannot make a non-member the chairman', async () => {
    const r = makeRig();
    await expect(r.svc.setChairman(teacher, 's1', 'g1', 'g2-m1')).rejects.toThrow(/not in this group/);
  });

  it("'rotate' hands the chair on every interval, waiting for a member's turn to end", async () => {
    const r = makeRig({ chairmanAssignment: 'automatic', chairmanStrategy: 'rotate', rotateEverySec: 60 });
    await r.svc.onSessionState('s1', 'RUNNING');
    await r.svc.grantFloor('g1-chair', ref, 'g1-m2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.g1.floor.chairmanStationId).toBe('g1-chair'); // deferred: g1-m2 is mid-turn
    await r.svc.revokeFloor('g1-chair', ref);
    expect(r.g1.floor.chairmanStationId).toBe('g1-m1'); // next member in seat order
  });

  it('mute-all ends the turn, clears the queue and server-mutes open mics', async () => {
    const r = makeRig();
    await r.svc.requestMic('g1-m2', ref);
    await r.svc.grantFloor('g1-chair', ref, 'g1-m1');
    await r.svc.requestMic('g1-m2', ref).catch(() => undefined);
    await r.svc.muteAll(teacher, 's1', 'g1');
    expect(r.g1.floor.speakerStationId).toBeNull();
    expect(r.g1.floor.queue).toEqual([]);
    expect(r.media.muteMicTracks).toHaveBeenCalled();
    expect(r.canPublish('st:g1-m1')).toBe(false);
  });
});

/** A minimal in-memory session DB so prepareOnArm's split-then-chairman flow
 * can be asserted on the resulting rows rather than on individual calls. */
function armRig(pool: Array<{ id: string; seatNo: number; claimed?: boolean; online?: boolean }>, cfg: Record<string, unknown>) {
  const r = makeRig();
  type Row = { id: string; index: number; members: Array<{ stationId: string; role: string }>; config: unknown };
  const db: Row[] = [{ id: 'grp-1', index: 1, members: pool.map((p) => ({ stationId: p.id, role: 'MEMBER' })), config: zRoundTableConfig.parse({ topic: 'T', ...cfg }) }];
  for (const p of pool) if (p.online === false) r.online.delete(p.id); else r.online.add(p.id);
  const seat = (id: string) => pool.find((p) => p.id === id)!;
  const shape = (g: Row) => ({
    id: g.id,
    index: g.index,
    activity: { config: g.config },
    members: g.members.map((m) => ({ ...m, station: { seatNo: seat(m.stationId).seatNo, currentUserId: seat(m.stationId).claimed === false ? null : 'user' } })),
  });
  let nextId = 2;
  const tx = {
    sessionMember: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const g = db.find((x) => x.id === where.groupId)!;
        g.members = g.members.filter((m) => where.stationId.notIn.includes(m.stationId));
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const g = db.find((x) => x.id === where.groupId)!;
        for (const m of g.members) if (!where.stationId || where.stationId === m.stationId) m.role = data.role;
      }),
    },
    sessionGroup: {
      create: vi.fn(async ({ data }: any) => {
        db.push({ id: `grp-${nextId++}`, index: data.index, members: data.members.create, config: data.activity.create.config });
      }),
    },
  };
  r.prisma.sessionGroup.findMany.mockImplementation((async (args: any) => (args.select ? db.map((g) => ({ index: g.index })) : db.map(shape))) as never);
  (r.prisma as any).$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)));
  (r.prisma.sessionMember.updateMany as any).mockImplementation(tx.sessionMember.updateMany);
  return { ...r, db, tx };
}

const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seatNo: i + 2 }));

describe('RoundTableService.prepareOnArm (RT-5 automatic)', () => {
  it('splits a pool of 20 at size 5 into 4 groups of 5, each with exactly one chairman', async () => {
    const r = armRig(pool(20), { participantAssignment: 'automatic', targetGroupSize: 5, chairmanAssignment: 'automatic' });
    await r.svc.prepareOnArm('s1', 'teach1');
    expect(r.db.map((g) => g.members.length)).toEqual([5, 5, 5, 5]);
    expect(r.db.map((g) => g.index)).toEqual([1, 2, 3, 4]);
    for (const g of r.db) expect(g.members.filter((m) => m.role === 'CHAIRMAN')).toHaveLength(1);
    expect(r.db.flatMap((g) => g.members.map((m) => m.stationId)).sort()).toEqual(pool(20).map((p) => p.id).sort());
    expect(r.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'round_table.auto_assign' }));
  });

  it('excludes offline and unclaimed stations from the split', async () => {
    const seats = pool(8).map((p, i) => ({ ...p, online: i !== 0, claimed: i !== 1 }));
    const r = armRig(seats, { participantAssignment: 'automatic', targetGroupSize: 3, chairmanAssignment: 'automatic' });
    await r.svc.prepareOnArm('s1', 'teach1');
    const kept = r.db.flatMap((g) => g.members.map((m) => m.stationId));
    expect(kept).not.toContain('p1');
    expect(kept).not.toContain('p2');
    expect(kept).toHaveLength(6);
  });

  it('new groups only use the session\'s free indices (cap 6)', async () => {
    const r = armRig(pool(40), { participantAssignment: 'automatic', targetGroupSize: 2, chairmanAssignment: 'automatic' });
    await r.svc.prepareOnArm('s1', 'teach1');
    expect(r.db).toHaveLength(6);
    expect(new Set(r.db.map((g) => g.index)).size).toBe(6);
  });

  it('refuses to arm when fewer than 2 stations qualify, and changes nothing', async () => {
    const seats = pool(4).map((p, i) => ({ ...p, online: i === 0 }));
    const r = armRig(seats, { participantAssignment: 'automatic', targetGroupSize: 2, chairmanAssignment: 'automatic' });
    await expect(r.svc.prepareOnArm('s1', 'teach1')).rejects.toThrow(/at least 2/);
    expect(r.db).toHaveLength(1);
    expect(r.db[0]!.members).toHaveLength(4);
  });

  it("automatic chairman with 'rotate' starts on the first seat; manual groups are left exactly as authored", async () => {
    const auto = armRig(pool(4), { chairmanAssignment: 'automatic', chairmanStrategy: 'rotate', rotateEverySec: 60 });
    await auto.svc.prepareOnArm('s1', 'teach1');
    expect(auto.db[0]!.members.find((m) => m.role === 'CHAIRMAN')?.stationId).toBe('p1');

    const manual = armRig(pool(4), {});
    manual.db[0]!.members[2]!.role = 'CHAIRMAN';
    await manual.svc.prepareOnArm('s1', 'teach1');
    expect(manual.db[0]!.members.map((m) => m.role)).toEqual(['MEMBER', 'MEMBER', 'CHAIRMAN', 'MEMBER']);
    expect(manual.audit.log).not.toHaveBeenCalled();
  });
});

describe('RoundTableService.review (RT-10, spec 7.3)', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  function reviewRig() {
    const r = makeRig();
    const activityStart = new Date(T0);
    r.prisma.sessionGroup.findUnique = vi.fn(async ({ where }: any) =>
        where.id === 'g1'
          ? {
              sessionId: 's1',
              activity: { id: 'ai-g1', type: 'ROUND_TABLE', startedAt: activityStart, config: { topic: 'Trade' } },
              members: r.g1.members.map((m, i) => ({ stationId: m.stationId, role: i === 0 ? 'CHAIRMAN' : 'MEMBER', station: { seatNo: m.seatNo, currentUser: i === 1 ? { fullName: 'Stu One' } : null } })),
            }
          : null,
    ) as never;
    r.prisma.roundTableTurn.findMany = vi.fn(async () => [
      { stationId: 'g1-chair', studentId: null, teacherUserId: null, role: 'CHAIRMAN', startMs: 0, endMs: 30_000 },
      { stationId: 'g1-m1', studentId: 'user-1', teacherUserId: null, role: 'MEMBER', startMs: 30_000, endMs: 45_000 },
      { stationId: null, studentId: null, teacherUserId: 'teach1', role: 'TEACHER', startMs: 50_000, endMs: 55_000 },
    ]) as never;
    r.prisma.recording.findMany = vi.fn(async () => [
      { id: 'rec-chair', stationId: 'g1-chair', status: 'ready', durationMs: 60_000, createdAt: new Date(T0 + 500) },
    ]) as never;
    return r;
  }

  it('returns members, timeline, per-station totals, teacher time, and seek offsets', async () => {
    const r = reviewRig();
    const out = await r.svc.review(teacher, 's1', 'g1');
    expect(out.topic).toBe('Trade');
    expect(out.members.map((m: any) => m.stationId)).toEqual(['g1-chair', 'g1-m1', 'g1-m2']);
    expect(out.members.find((m: any) => m.stationId === 'g1-m1')?.studentName).toBe('Stu One');
    expect(out.turns).toHaveLength(3);
    expect(out.totals.find((t: any) => t.stationId === 'g1-chair')).toMatchObject({ speakingMs: 30_000, neverSpoke: false });
    expect(out.totals.find((t: any) => t.stationId === 'g1-m2')).toMatchObject({ neverSpoke: true });
    expect(out.teacherMs).toBe(5000);
    expect(out.recordings[0]).toMatchObject({ id: 'rec-chair', offsetMs: 500 });
    expect(r.batchAccess.assertCanUseBatch).toHaveBeenCalled();
  });

  it('refuses a group from another session or that is not a Round Table', async () => {
    const r = reviewRig();
    await expect(r.svc.review(teacher, 'other-session', 'g1')).rejects.toThrow(/not a Round Table/);
    r.prisma.sessionGroup.findUnique = vi.fn(async () => null) as never;
    await expect(r.svc.review(teacher, 's1', 'g1')).rejects.toThrow(/not a Round Table/);
  });

  it('checks the batch before returning anything', async () => {
    const r = reviewRig();
    r.batchAccess.assertCanUseBatch.mockRejectedValueOnce(new Error('not assigned'));
    await expect(r.svc.review(teacher, 's1', 'g1')).rejects.toThrow(/not assigned/);
  });
});
