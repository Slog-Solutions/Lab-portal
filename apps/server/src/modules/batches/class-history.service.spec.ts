import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { NO_WRITTEN_FEEDBACK } from '@lab/shared';
import { ClassHistoryService } from './class-history.service';
import type { PrismaService } from '../../prisma/prisma.service';

const ME = 'stu-me';
const CLASS = 'batch1';

const enrollment = {
  batch: { id: CLASS, code: 'ENG-B1', name: 'Morning English', teachers: [{ teacher: { fullName: 'Laksh' } }] },
};

function membership(over: { stationId?: string; role?: string; type?: string; config?: unknown; instanceId?: string; state?: string } = {}) {
  return {
    stationId: over.stationId ?? 'st-me',
    role: over.role ?? 'MEMBER',
    group: {
      index: 1,
      session: {
        id: 'sess1',
        title: 'Monday practice',
        state: over.state ?? 'ENDED',
        startedAt: new Date('2026-09-20T10:00:00Z'),
        createdAt: new Date('2026-09-20T09:00:00Z'),
      },
      activity: { id: over.instanceId ?? 'inst1', type: over.type ?? 'ROUND_TABLE', config: over.config ?? { topic: ' Climate ' } },
      members: [
        { studentId: ME, student: { fullName: 'Saja Me' } },
        { studentId: 'stu-2', student: { fullName: 'Ravi Kumar' } },
        { studentId: null, student: null },
      ],
    },
  };
}

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    enrollment: { findUnique: vi.fn().mockResolvedValue(enrollment) },
    sessionMember: { findMany: vi.fn().mockResolvedValue([membership()]) },
    recording: { findMany: vi.fn().mockResolvedValue([]) },
    roundTableTurn: { findMany: vi.fn().mockResolvedValue([]) },
    assignment: { findMany: vi.fn().mockResolvedValue([]) },
    ...over,
  };
}

const svcFor = (prisma: ReturnType<typeof makePrisma>) => new ClassHistoryService(prisma as unknown as PrismaService);

describe('ClassHistoryService.forStudent', () => {
  it('refuses a student who is not enrolled in the class', async () => {
    const prisma = makePrisma({ enrollment: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(svcFor(prisma).forStudent(ME, CLASS)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.sessionMember.findMany).not.toHaveBeenCalled();
  });

  it("only reads this class's non-draft sessions the student was stamped into", async () => {
    const prisma = makePrisma();
    await svcFor(prisma).forStudent(ME, CLASS);
    expect(prisma.sessionMember.findMany.mock.calls[0]![0].where).toEqual({
      studentId: ME,
      group: { session: { batchId: CLASS, state: { not: 'DRAFT' } } },
    });
  });

  it('describes the activity: label, trimmed topic, role, and groupmates without the student or empty seats', async () => {
    const prisma = makePrisma({ sessionMember: { findMany: vi.fn().mockResolvedValue([membership({ role: 'CHAIRMAN' })]) } });
    const view = await svcFor(prisma).forStudent(ME, CLASS);

    expect(view.class).toEqual({ id: CLASS, code: 'ENG-B1', name: 'Morning English', teacherNames: ['Laksh'] });
    expect(view.activities).toHaveLength(1);
    expect(view.activities[0]).toMatchObject({
      sessionId: 'sess1',
      sessionTitle: 'Monday practice',
      date: '2026-09-20T10:00:00.000Z',
      activityType: 'ROUND_TABLE',
      activityLabel: 'Round Table Discussion',
      topic: 'Climate',
      role: 'CHAIRMAN',
      groupmates: ['Ravi Kumar'],
    });
  });

  it("uses Telephone's scenario as the topic and gives non-Round-Table activities no turn stats", async () => {
    const prisma = makePrisma({
      sessionMember: { findMany: vi.fn().mockResolvedValue([membership({ type: 'TELEPHONE', config: { scenario: 'Book a hotel' } })]) },
    });
    const [entry] = (await svcFor(prisma).forStudent(ME, CLASS)).activities;
    expect(entry).toMatchObject({ activityLabel: 'Telephone Activity', topic: 'Book a hotel', roundTable: null });
  });

  it("keeps only the student's own recordings — by name, or by their seat when a recording names nobody", async () => {
    const at = new Date('2026-09-20T10:05:00Z');
    const rec = (id: string, stationId: string, studentIds: string[]) => ({
      id,
      kind: 'GROUP_DISCUSSION',
      status: 'ready',
      durationMs: 1000,
      createdAt: at,
      activityInstanceId: 'inst1',
      stationId,
      studentIds,
    });
    const prisma = makePrisma({
      recording: {
        // forStudent now makes two different recording.findMany calls
        // (this activity-scoped one, and classRecordings' kind-scoped
        // one) — only answer the former, or classRecordings would map
        // these same GROUP_DISCUSSION rows as if they were its own.
        findMany: vi.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
          where.kind
            ? []
            : [rec('r-named', 'st-other', [ME]), rec('r-legacy', 'st-me', []), rec('r-legacy-other', 'st-other', [])],
        ),
      },
    });
    const [entry] = (await svcFor(prisma).forStudent(ME, CLASS)).activities;

    expect(entry!.recordings.map((r) => r.id)).toEqual(['r-named', 'r-legacy']);
    // Two different recording.findMany calls now happen (this one, and
    // classRecordings' own) — find this one by shape rather than assuming
    // array position, since their relative order isn't a contract.
    const activityCall = prisma.recording.findMany.mock.calls.find((call) => 'activityInstanceId' in (call[0] as { where: Record<string, unknown> }).where);
    expect(activityCall![0].where).toEqual({
      activityInstanceId: { in: ['inst1'] },
      OR: [{ studentIds: { has: ME } }, { studentIds: { isEmpty: true } }],
    });
  });

  it("totals the student's Round Table turns — by name, or by their seat for older turns that name nobody", async () => {
    const prisma = makePrisma({
      roundTableTurn: {
        findMany: vi.fn().mockResolvedValue([
          { activityInstanceId: 'inst1', stationId: 'st-me', studentId: ME, startMs: 0, endMs: 30_000 },
          { activityInstanceId: 'inst1', stationId: 'st-me', studentId: null, startMs: 60_000, endMs: 75_000 },
          { activityInstanceId: 'inst1', stationId: 'st-other', studentId: null, startMs: 80_000, endMs: 90_000 },
        ]),
      },
    });
    const [entry] = (await svcFor(prisma).forStudent(ME, CLASS)).activities;
    expect(entry!.roundTable).toEqual({ turns: 2, speakingMs: 45_000 });
    expect(prisma.roundTableTurn.findMany.mock.calls[0]![0].where).toEqual({
      activityInstanceId: { in: ['inst1'] },
      OR: [{ studentId: ME }, { studentId: null, stationId: { in: ['st-me'] } }],
    });
  });

  it('skips the per-activity recording and turn queries when there are no activities (classRecordings still runs, independently)', async () => {
    const prisma = makePrisma({ sessionMember: { findMany: vi.fn().mockResolvedValue([]) } });
    const view = await svcFor(prisma).forStudent(ME, CLASS);
    expect(view.activities).toEqual([]);
    expect(prisma.recording.findMany.mock.calls.some((call) => 'activityInstanceId' in (call[0] as { where: Record<string, unknown> }).where)).toBe(false);
    expect(prisma.roundTableTurn.findMany).not.toHaveBeenCalled();
  });

  it("lists only this class's assignments, with the latest attempt's score and written feedback", async () => {
    const prisma = makePrisma({
      assignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a1',
            dueAt: new Date('2026-09-25T00:00:00Z'),
            createdAt: new Date('2026-09-21T00:00:00Z'),
            exercise: { title: 'Essay', type: 'WRITING_TEST' },
            attempts: [
              { status: 'SCORED', rawScore: 7, maxScore: 10, submittedAt: new Date('2026-09-22T00:00:00Z'), scoreOverride: { reason: 'Good work' } },
            ],
          },
          {
            id: 'a2',
            dueAt: null,
            createdAt: new Date('2026-09-20T00:00:00Z'),
            exercise: { title: 'Words', type: 'VOCABULARY_TEST' },
            attempts: [{ status: 'SCORED', rawScore: 5, maxScore: 5, submittedAt: null, scoreOverride: { reason: NO_WRITTEN_FEEDBACK } }],
          },
          { id: 'a3', dueAt: null, createdAt: new Date('2026-09-19T00:00:00Z'), exercise: { title: 'Listen', type: 'LISTENING_TEST' }, attempts: [] },
        ]),
      },
    });
    const view = await svcFor(prisma).forStudent(ME, CLASS);

    expect(prisma.assignment.findMany.mock.calls[0]![0].where).toEqual({ studentId: ME, batchId: CLASS });
    expect(view.assignments[0]).toEqual({
      assignmentId: 'a1',
      title: 'Essay',
      type: 'WRITING_TEST',
      typeLabel: 'Writing Test',
      dueAt: '2026-09-25T00:00:00.000Z',
      createdAt: '2026-09-21T00:00:00.000Z',
      latestAttempt: { status: 'SCORED', percent: 70, submittedAt: '2026-09-22T00:00:00.000Z', feedback: 'Good work' },
    });
    expect(view.assignments[1]!.latestAttempt).toMatchObject({ percent: 100, feedback: null });
    expect(view.assignments[2]!.latestAttempt).toBeNull();
  });

  it("lists the class's own broadcast recordings, scoped by the live class's batchId", async () => {
    const prisma = makePrisma({
      recording: {
        findMany: vi.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
          where.kind
            ? [
                {
                  id: 'cr1',
                  withAudio: true,
                  durationMs: 90_000,
                  status: 'ready',
                  updatedAt: new Date(),
                  createdAt: new Date('2026-09-20T10:00:00Z'),
                  liveClass: { title: "Laksh's class" },
                },
              ]
            : [],
        ),
      },
    });
    const view = await svcFor(prisma).forStudent(ME, CLASS);

    expect(prisma.recording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'CLASS_BROADCAST', liveClass: { batchId: CLASS } } }),
    );
    expect(view.classRecordings).toEqual([
      { id: 'cr1', classTitle: "Laksh's class", withAudio: true, durationMs: 90_000, status: 'ready', createdAt: '2026-09-20T10:00:00.000Z' },
    ]);
  });

  it('never shows a failed (nothing captured) class recording to a student', async () => {
    const prisma = makePrisma({
      recording: {
        findMany: vi.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
          where.kind
            ? [{ id: 'cr-failed', withAudio: true, durationMs: 5000, status: 'failed', updatedAt: new Date(), createdAt: new Date(), liveClass: null }]
            : [],
        ),
      },
    });
    const view = await svcFor(prisma).forStudent(ME, CLASS);
    expect(view.classRecordings).toEqual([]);
  });

  it('reports a stale in-progress class recording as incomplete, the same rule as the teacher\'s own Recordings page', async () => {
    const staleUpdatedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma = makePrisma({
      recording: {
        findMany: vi.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
          where.kind
            ? [{ id: 'cr-stale', withAudio: false, durationMs: null, status: 'recording', updatedAt: staleUpdatedAt, createdAt: staleUpdatedAt, liveClass: null }]
            : [],
        ),
      },
    });
    const view = await svcFor(prisma).forStudent(ME, CLASS);
    expect(view.classRecordings[0]).toMatchObject({ status: 'incomplete' });
  });
});
