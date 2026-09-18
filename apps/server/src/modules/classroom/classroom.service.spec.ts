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
import type { JwtPayload } from '../auth/auth.service';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    liveClass: { findUnique: vi.fn(), update: vi.fn() },
    station: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFakeStations() {
  return { release: vi.fn().mockResolvedValue(undefined) };
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
    pushSnapshot: vi.fn(),
    sendFullStatusToTeacher: vi.fn().mockResolvedValue(undefined),
    sendStatusRow: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeMedia() {
  return { deleteRoom: vi.fn().mockResolvedValue(undefined) };
}

function makeFakeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

function makeFakeLocks() {
  return { unlock: vi.fn(), lock: vi.fn(), get: vi.fn(), listLockedStationIds: vi.fn() };
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
  );
}

const teacher: JwtPayload = { sub: 'teacher1', role: UserRole.TEACHER, serviceNumber: 'T-1' };

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
    const service = makeService({
      prisma,
      stations: makeFakeStations(),
      presence: makeFakePresence(),
      sessionState,
      gateway: makeFakeGateway(),
      media: makeFakeMedia(),
      audit: makeFakeAudit(),
      locks,
    });

    await service.end('class1', teacher);

    expect(locks.unlock).toHaveBeenCalledWith('st1');
    expect(locks.unlock).toHaveBeenCalledWith('st2');
    // Unlocked before the snapshot that goes out to the station is computed
    // — otherwise SessionStateService.getDesiredState would re-read a lock
    // that's about to be cleared and re-send it one more time.
    expect(locks.unlock.mock.invocationCallOrder[0]).toBeLessThan(sessionState.getDesiredState.mock.invocationCallOrder[0]!);
  });

  it('releaseStudent() (force release) unlocks the station before computing its next snapshot', async () => {
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

    expect(locks.unlock).toHaveBeenCalledWith('st1');
    expect(locks.unlock.mock.invocationCallOrder[0]).toBeLessThan(sessionState.getDesiredState.mock.invocationCallOrder[0]!);
  });

  it('signOut() (student self-release) also unlocks the station', async () => {
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

    expect(locks.unlock).toHaveBeenCalledWith('st1');
  });
});
