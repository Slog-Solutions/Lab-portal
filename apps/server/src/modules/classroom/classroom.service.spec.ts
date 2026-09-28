import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@lab/shared';
import { ClassroomService } from './classroom.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StationsService } from '../stations/stations.service';
import type { PresenceService } from '../control/presence.service';
import type { SessionStateService } from '../control/session-state.service';
import type { ControlGateway } from '../control/control.gateway';
import type { MediaService } from '../media/media.service';
import type { AuditService } from '../audit/audit.service';
import type { LockService } from '../control/lock.service';
import type { ScreenShareService } from '../control/screen-share.service';
import type { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    liveClass: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn() },
    station: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    user: { findUniqueOrThrow: vi.fn() },
    batch: { findUniqueOrThrow: vi.fn() },
    enrollment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFakeStations(overrides: Record<string, unknown> = {}) {
  return { release: vi.fn().mockResolvedValue(undefined), ...overrides };
}

function makeFakePresence(overrides: Record<string, unknown> = {}) {
  return { get: vi.fn(), setMembership: vi.fn(), ...overrides };
}

function makeFakeSessionState() {
  return { getDesiredState: vi.fn().mockResolvedValue({ lock: null }) };
}

function makeFakeGateway() {
  return {
    emitToStation: vi.fn(),
    emitIdentity: vi.fn(),
    pushSnapshot: vi.fn(),
    sendFullStatusToTeacher: vi.fn().mockResolvedValue(undefined),
    sendStatusRow: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeMedia() {
  return { ensureRoom: vi.fn().mockResolvedValue(undefined), deleteRoom: vi.fn().mockResolvedValue(undefined) };
}

function makeFakeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

function makeFakeLocks() {
  return {
    unlock: vi.fn().mockResolvedValue(undefined),
    unlockUser: vi.fn().mockResolvedValue(undefined),
    clearStationGrant: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    getSeatOccupant: vi.fn(),
    setSeatOccupant: vi.fn(),
    listLockedStationIds: vi.fn(),
  };
}

function makeFakeScreenShares() {
  return { clearRoom: vi.fn(), clearByStation: vi.fn(), set: vi.fn(), getRoomFor: vi.fn(), isPresenting: vi.fn() };
}

function makeFakeBatchAccess() {
  return { assertCanUseBatch: vi.fn().mockResolvedValue(undefined) };
}

function makeService(deps: {
  prisma: ReturnType<typeof makeFakePrisma>;
  stations: ReturnType<typeof makeFakeStations>;
  presence: ReturnType<typeof makeFakePresence>;
  sessionState: ReturnType<typeof makeFakeSessionState>;
  gateway: ReturnType<typeof makeFakeGateway>;
  media: ReturnType<typeof makeFakeMedia>;
  audit: ReturnType<typeof makeFakeAudit>;
  locks: ReturnType<typeof makeFakeLocks>;
  screenShares?: ReturnType<typeof makeFakeScreenShares>;
  batchAccess?: ReturnType<typeof makeFakeBatchAccess>;
}): ClassroomService {
  return new ClassroomService(
    deps.prisma as unknown as PrismaService,
    deps.stations as unknown as StationsService,
    deps.presence as unknown as PresenceService,
    deps.sessionState as unknown as SessionStateService,
    deps.gateway as unknown as ControlGateway,
    deps.media as unknown as MediaService,
    deps.audit as unknown as AuditService,
    deps.locks as unknown as LockService,
    (deps.screenShares ?? makeFakeScreenShares()) as unknown as ScreenShareService,
    (deps.batchAccess ?? makeFakeBatchAccess()) as unknown as BatchAccessService,
  );
}

const teacher: JwtPayload = { sub: 'teacher1', role: UserRole.TEACHER, serviceNumber: 'T-1' };

/** Convenience wrapper over makeService for tests that only care about
 * overriding a couple of deps (prisma, stations, batchAccess) — start()'s
 * own tests don't touch locks/presence/screen shares at all. */
function makeDefaultService(overrides: {
  prisma?: ReturnType<typeof makeFakePrisma>;
  stations?: ReturnType<typeof makeFakeStations>;
  batchAccess?: ReturnType<typeof makeFakeBatchAccess>;
  gateway?: ReturnType<typeof makeFakeGateway>;
  presence?: ReturnType<typeof makeFakePresence>;
}) {
  return makeService({
    prisma: overrides.prisma ?? makeFakePrisma(),
    stations: overrides.stations ?? makeFakeStations(),
    presence: overrides.presence ?? makeFakePresence(),
    sessionState: makeFakeSessionState(),
    gateway: overrides.gateway ?? makeFakeGateway(),
    media: makeFakeMedia(),
    audit: makeFakeAudit(),
    locks: makeFakeLocks(),
    batchAccess: overrides.batchAccess,
  });
}

describe('ClassroomService.start', () => {
  it('ad hoc (no batchId): creates a class titled after the teacher, batchId null', async () => {
    const prisma = makeFakePrisma();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A Teacher' });
    prisma.liveClass.create.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: "A Teacher's class", teacherId: 'teacher1', state: 'ACTIVE', batchId: null });
    const batchAccess = makeFakeBatchAccess();

    const result = await makeDefaultService({ prisma, batchAccess }).start(teacher, {});

    expect(prisma.liveClass.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "A Teacher's class", batchId: undefined }) }));
    expect(batchAccess.assertCanUseBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'class1', batchId: null });
  });

  it('batch-scoped: checks the teacher may use the batch, defaults the title to its name, and attaches every already-signed-in enrolled student', async () => {
    const prisma = makeFakePrisma({
      enrollment: { findMany: vi.fn().mockResolvedValue([{ userId: 'stu1' }, { userId: 'stu2' }]) },
    });
    prisma.batch.findUniqueOrThrow.mockResolvedValue({ name: 'English' });
    prisma.liveClass.create.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: 'English', teacherId: 'teacher1', state: 'ACTIVE', batchId: 'batch1' });
    const attachEnrolledStudents = vi.fn().mockResolvedValue([
      { stationId: 'st1', seatNo: 3, previousTeacherId: null },
      { stationId: 'st2', seatNo: 4, previousTeacherId: 'teacher0' },
    ]);
    const stations = makeFakeStations({ attachEnrolledStudents });
    const batchAccess = makeFakeBatchAccess();
    const gateway = makeFakeGateway();
    const presence = makeFakePresence();

    const result = await makeDefaultService({ prisma, stations, batchAccess, gateway, presence }).start(teacher, { batchId: 'batch1' });

    expect(batchAccess.assertCanUseBatch).toHaveBeenCalledWith(teacher, 'batch1');
    expect(prisma.liveClass.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'English', batchId: 'batch1' }) }));
    expect(attachEnrolledStudents).toHaveBeenCalledWith('class1', ['stu1', 'stu2']);
    // One already-seated student joins clean; the other was in a different
    // teacher's class and must be treated as a move (spotlight cleared,
    // that teacher's board refreshed) — same as a by-code join.
    expect(presence.setMembership).toHaveBeenCalledWith('st1', { seatNo: 3, classTeacherId: 'teacher1' });
    expect(presence.setMembership).toHaveBeenCalledWith('st2', { seatNo: 4, classTeacherId: 'teacher1' });
    expect(gateway.sendFullStatusToTeacher).toHaveBeenCalledWith('teacher0');
    expect(gateway.pushSnapshot).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: 'class1', batchId: 'batch1' });
  });

  it('an explicit title overrides the batch-name default', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.create.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: 'Period 3', teacherId: 'teacher1', state: 'ACTIVE', batchId: 'batch1' });

    await makeDefaultService({ prisma }).start(teacher, { title: 'Period 3', batchId: 'batch1' });

    expect(prisma.batch.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.liveClass.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Period 3' }) }));
  });

  it('idempotent: a teacher who already has an active class for a different batch just gets its scope extended, not a second class', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: 'Morning class', teacherId: 'teacher1', state: 'ACTIVE', batchId: 'batch0' });
    prisma.liveClass.update.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: 'Morning class', teacherId: 'teacher1', state: 'ACTIVE', batchId: 'batch1' });

    const result = await makeDefaultService({ prisma }).start(teacher, { batchId: 'batch1' });

    expect(prisma.liveClass.create).not.toHaveBeenCalled();
    expect(prisma.liveClass.update).toHaveBeenCalledWith({ where: { id: 'class1' }, data: { batchId: 'batch1' } });
    expect(result).toMatchObject({ id: 'class1', batchId: 'batch1' });
  });

  it('idempotent: starting again for the SAME batch touches nothing', async () => {
    const prisma = makeFakePrisma({ enrollment: { findMany: vi.fn().mockResolvedValue([{ userId: 'stu1' }]) } });
    prisma.liveClass.findFirst.mockResolvedValue({ id: 'class1', code: 'ABCDEF', title: 'English', teacherId: 'teacher1', state: 'ACTIVE', batchId: 'batch1' });
    const attachEnrolledStudents = vi.fn().mockResolvedValue([]);
    const stations = makeFakeStations({ attachEnrolledStudents });

    await makeDefaultService({ prisma, stations }).start(teacher, { batchId: 'batch1' });

    expect(prisma.liveClass.update).not.toHaveBeenCalled();
    // Re-attaching already-signed-in students is still useful (a late
    // arrival between the first start() and this one), so this call runs
    // every time, not just on creation.
    expect(attachEnrolledStudents).toHaveBeenCalledWith('class1', ['stu1']);
  });
});

/**
 * Regression guard: a station's lock lease used to outlive its class
 * membership. Once the station left the class (class ended, or a
 * teacher/admin released the seat) with no unlock code path run,
 * ClassAccessService would then 403 the teacher's own Unlock (station no
 * longer in their class), and ControlGateway's 15s heartbeat kept
 * renewing a lock nobody could ever clear again.
 */
describe('ClassroomService — clearing locks on class exit', () => {
  it('end() unlocks every member station before pushing its final snapshot', async () => {
    const prisma = makeFakePrisma({
      liveClass: {
        findUnique: vi.fn().mockResolvedValue({ id: 'class1', teacherId: 'teacher1', code: 'ABCDEF', title: 'Class', state: 'ACTIVE' }),
        update: vi.fn(),
      },
      station: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'st1', seatNo: 2 },
          { id: 'st2', seatNo: null },
        ]),
        updateMany: vi.fn(),
      },
    });
    const locks = makeFakeLocks();
    const sessionState = makeFakeSessionState();
    const gateway = makeFakeGateway();
    const service = makeService({
      prisma,
      stations: makeFakeStations(),
      presence: makeFakePresence(),
      sessionState,
      gateway,
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks,
    });

    await service.end('class1', teacher);

    expect(locks.unlock).toHaveBeenCalledWith('st1');
    expect(locks.unlock).toHaveBeenCalledWith('st2');
    // A signed-in student stays seated when the class ends (only the
    // broadcast/roster link drops) — their seatOccupant mapping is
    // untouched, unlike releaseStudent()/signOut() below which really do
    // vacate the seat.
    expect(locks.setSeatOccupant).not.toHaveBeenCalled();
    // Unlocked before the snapshot that goes out to the station is computed
    // — otherwise SessionStateService.getDesiredState would re-read a lock
    // that's about to be cleared and re-send it one more time.
    expect(locks.unlock.mock.invocationCallOrder[0]).toBeLessThan(sessionState.getDesiredState.mock.invocationCallOrder[0]!);
  });

  it('end() detaches stations from the class without signing their students out', async () => {
    const prisma = makeFakePrisma({
      liveClass: {
        findUnique: vi.fn().mockResolvedValue({ id: 'class1', teacherId: 'teacher1', code: 'ABCDEF', title: 'Class', state: 'ACTIVE' }),
        update: vi.fn(),
      },
      station: {
        findMany: vi.fn().mockResolvedValue([{ id: 'st1', seatNo: 2 }]),
        updateMany: vi.fn(),
      },
    });
    const gateway = makeFakeGateway();
    const service = makeService({
      prisma,
      stations: makeFakeStations(),
      presence: makeFakePresence(),
      sessionState: makeFakeSessionState(),
      gateway,
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks: makeFakeLocks(),
    });

    await service.end('class1', teacher);

    // Only the class link clears — currentUserId is deliberately left
    // alone, so the student stays signed in at their seat and just loses
    // the broadcast (see JoinLiveClassCard's "no live class" state).
    expect(prisma.station.updateMany).toHaveBeenCalledWith({ where: { liveClassId: 'class1' }, data: { liveClassId: null } });
    // No 'student:signed-out' — that event is reserved for an actual
    // release (releaseStudent/signOut), which does clear currentUserId.
    expect(gateway.emitToStation).not.toHaveBeenCalled();
  });

  it('releaseStudent() (force release) detaches the seat and clears only the station grant, before computing its next snapshot', async () => {
    const presence = makeFakePresence({ get: vi.fn().mockReturnValue({ classTeacherId: 'teacher1', seatNo: 5 }) });
    const locks = makeFakeLocks();
    const sessionState = makeFakeSessionState();
    const service = makeService({
      prisma: makeFakePrisma(),
      stations: makeFakeStations(),
      presence,
      sessionState,
      gateway: makeFakeGateway(),
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks,
    });

    await service.releaseStudent('st1', teacher);

    // NOT the full unlock() — that would also delete the departing
    // student's own persisted grant and defeat "the lock follows the
    // student" the moment they change seats.
    expect(locks.unlock).not.toHaveBeenCalled();
    expect(locks.setSeatOccupant).toHaveBeenCalledWith('st1', null);
    expect(locks.clearStationGrant).toHaveBeenCalledWith('st1');
    expect(locks.setSeatOccupant.mock.invocationCallOrder[0]).toBeLessThan(sessionState.getDesiredState.mock.invocationCallOrder[0]!);
  });

  it('signOut() (student self-release) also detaches the seat and clears the station grant', async () => {
    const presence = makeFakePresence({ get: vi.fn().mockReturnValue({ classTeacherId: 'teacher1', seatNo: 5 }) });
    const locks = makeFakeLocks();
    const service = makeService({
      prisma: makeFakePrisma(),
      stations: makeFakeStations(),
      presence,
      sessionState: makeFakeSessionState(),
      gateway: makeFakeGateway(),
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks,
    });

    await service.signOut('st1');

    expect(locks.setSeatOccupant).toHaveBeenCalledWith('st1', null);
    expect(locks.clearStationGrant).toHaveBeenCalledWith('st1');
  });
});

describe('ClassroomService.signIn — the lock follows the student', () => {
  it('attaches the signed-in student as the seat occupant before computing the snapshot', async () => {
    const stations = makeFakeStations({
      claim: vi.fn().mockResolvedValue({
        userId: 'student1',
        fullName: 'A Student',
        serviceNumber: 'S-1',
        studentToken: 'tok',
        seatNo: 3,
        liveClass: { id: 'class1', title: 'Class', teacherId: 'teacher1', teacherName: 'A Teacher' },
        movedFromStationId: null,
      }),
    });
    const locks = makeFakeLocks();
    const sessionState = makeFakeSessionState();
    const service = makeService({
      prisma: makeFakePrisma(),
      stations,
      presence: makeFakePresence(),
      sessionState,
      gateway: makeFakeGateway(),
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks,
    });

    await service.signIn('st1', { serviceNumber: 'S-1', password: 'pw', classCode: 'ABCDEF', systemNumber: 2 });

    expect(locks.setSeatOccupant).toHaveBeenCalledWith('st1', 'student1');
    expect(locks.setSeatOccupant.mock.invocationCallOrder[0]).toBeLessThan(sessionState.getDesiredState.mock.invocationCallOrder[0]!);
  });
});

describe('ClassroomService.signIn — signing in without a class', () => {
  it('signs in with no live class: null classTeacherId in presence, null liveClass in the response', async () => {
    const stations = makeFakeStations({
      claim: vi.fn().mockResolvedValue({
        userId: 'student1',
        fullName: 'A Student',
        serviceNumber: 'S-1',
        studentToken: 'tok',
        seatNo: 3,
        liveClass: null,
        movedFromStationId: null,
      }),
    });
    const presence = makeFakePresence();
    const service = makeService({
      prisma: makeFakePrisma(),
      stations,
      presence,
      sessionState: makeFakeSessionState(),
      gateway: makeFakeGateway(),
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks: makeFakeLocks(),
    });

    const result = await service.signIn('st1', { serviceNumber: 'S-1', password: 'pw', systemNumber: 2 });

    expect(result.liveClass).toBeNull();
    expect(result.studentToken).toBe('tok');
    expect(presence.setMembership).toHaveBeenCalledWith('st1', { seatNo: 3, classTeacherId: null });
  });
});

describe('ClassroomService.joinLiveClass', () => {
  const liveClass = { id: 'class1', title: 'Evening', teacherId: 'teacher1', teacherName: 'A Teacher' };

  function setup(attach: { seatNo: number | null; previousTeacherId: string | null }) {
    const attachToLiveClass = vi.fn().mockResolvedValue({ ...attach, liveClass });
    const stations = makeFakeStations({ attachToLiveClass });
    const presence = makeFakePresence();
    const gateway = makeFakeGateway();
    const sessionState = makeFakeSessionState();
    const screenShares = makeFakeScreenShares();
    const service = makeService({
      prisma: makeFakePrisma(),
      stations,
      presence,
      sessionState,
      gateway,
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks: makeFakeLocks(),
      screenShares,
    });
    return { service, attachToLiveClass, presence, gateway, sessionState, screenShares };
  }

  it('puts the seat into the class: membership, a fresh snapshot, and the status row', async () => {
    const { service, attachToLiveClass, presence, gateway, sessionState } = setup({ seatNo: 6, previousTeacherId: null });

    const result = await service.joinLiveClass('st1', { classCode: 'ABCDEF' });

    expect(attachToLiveClass).toHaveBeenCalledWith('st1', 'ABCDEF');
    expect(presence.setMembership).toHaveBeenCalledWith('st1', { seatNo: 6, classTeacherId: 'teacher1' });
    expect(gateway.pushSnapshot).toHaveBeenCalledTimes(1);
    expect(sessionState.getDesiredState.mock.invocationCallOrder[0]).toBeLessThan(gateway.pushSnapshot.mock.invocationCallOrder[0]!);
    expect(gateway.sendStatusRow).toHaveBeenCalledWith('st1');
    expect(result).toEqual({ ok: true, liveClass: { id: 'class1', title: 'Evening', teacherName: 'A Teacher' } });
  });

  it('a first join leaves other teachers and spotlight state alone', async () => {
    const { service, gateway, screenShares } = setup({ seatNo: 6, previousTeacherId: null });

    await service.joinLiveClass('st1', { classCode: 'ABCDEF' });

    expect(screenShares.clearByStation).not.toHaveBeenCalled();
    expect(gateway.sendFullStatusToTeacher).not.toHaveBeenCalled();
  });

  it('moving between classes drops the old spotlight reservation and refreshes the teacher it left', async () => {
    const { service, gateway, screenShares } = setup({ seatNo: 6, previousTeacherId: 'teacher0' });

    await service.joinLiveClass('st1', { classCode: 'ABCDEF' });

    expect(screenShares.clearByStation).toHaveBeenCalledWith('st1');
    expect(gateway.sendFullStatusToTeacher).toHaveBeenCalledWith('teacher0');
  });

  it('re-joining the SAME teacher’s class does not treat it as a move', async () => {
    const { service, gateway, screenShares } = setup({ seatNo: 6, previousTeacherId: 'teacher1' });

    await service.joinLiveClass('st1', { classCode: 'ABCDEF' });

    expect(screenShares.clearByStation).not.toHaveBeenCalled();
    expect(gateway.sendFullStatusToTeacher).not.toHaveBeenCalled();
  });
});
