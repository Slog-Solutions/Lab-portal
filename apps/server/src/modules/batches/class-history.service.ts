import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  NO_WRITTEN_FEEDBACK,
  RecordingKind,
  SessionState,
  type ClassActivityEntry,
  type ClassAssignmentEntry,
  type ClassHistoryView,
  type ClassRecordingHistoryEntry,
  type SessionRole,
} from '@lab/shared';
import { getActivity, hasActivity } from '@lab/shared/activities';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveClassRecordingStatus } from '../recordings/class-recording-status';

function labelFor(type: string): string {
  return hasActivity(type as ActivityType) ? getActivity(type as ActivityType).label : type;
}

/** Round Table / Interpreting `topic`, or Telephone's `scenario`. */
function topicOf(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as { topic?: unknown; scenario?: unknown };
  const value = typeof c.topic === 'string' ? c.topic : typeof c.scenario === 'string' ? c.scenario : null;
  return value?.trim() || null;
}

/**
 * A student's record of one class (the student app's "My Classes" screen):
 * every live activity they took part in there, and every assignment the
 * teacher created from it.
 *
 * "Took part" is SessionMember.studentId — stamped from whoever was signed in
 * at the seat (SessionsService.create/arm/start), since the live engine
 * itself is seat-based. A recording or Round Table turn is theirs when it
 * names them (both are attributed to the seat's student when made); older
 * rows that name nobody fall back to the seat they sat at in that group.
 */
@Injectable()
export class ClassHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async forStudent(studentId: string, batchId: string): Promise<ClassHistoryView> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_batchId: { userId: studentId, batchId } },
      select: {
        batch: {
          select: { id: true, code: true, name: true, teachers: { select: { teacher: { select: { fullName: true } } } } },
        },
      },
    });
    if (!enrollment) throw new ForbiddenException('You are not in this class');

    const [activities, assignments, classRecordings] = await Promise.all([
      this.activities(studentId, batchId),
      this.assignments(studentId, batchId),
      this.classRecordings(batchId),
    ]);
    const { batch } = enrollment;
    return {
      class: { id: batch.id, code: batch.code, name: batch.name, teacherNames: batch.teachers.map((t) => t.teacher.fullName) },
      activities,
      classRecordings,
      assignments,
    };
  }

  private async activities(studentId: string, batchId: string): Promise<ClassActivityEntry[]> {
    // A DRAFT was never delivered to anyone, so it isn't history yet.
    const memberships = await this.prisma.sessionMember.findMany({
      where: { studentId, group: { session: { batchId, state: { not: SessionState.DRAFT } } } },
      select: {
        stationId: true,
        role: true,
        group: {
          select: {
            index: true,
            session: { select: { id: true, title: true, state: true, startedAt: true, createdAt: true } },
            activity: { select: { id: true, type: true, config: true } },
            members: { select: { studentId: true, student: { select: { fullName: true } } } },
          },
        },
      },
    });

    const instanceIds = memberships.flatMap((m) => (m.group.activity ? [m.group.activity.id] : []));
    const [recordings, turns] =
      instanceIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.recording.findMany({
              where: {
                activityInstanceId: { in: instanceIds },
                OR: [{ studentIds: { has: studentId } }, { studentIds: { isEmpty: true } }],
              },
              select: {
                id: true,
                kind: true,
                status: true,
                durationMs: true,
                createdAt: true,
                activityInstanceId: true,
                stationId: true,
                studentIds: true,
              },
              orderBy: { createdAt: 'asc' },
            }),
            this.prisma.roundTableTurn.findMany({
              where: {
                activityInstanceId: { in: instanceIds },
                OR: [{ studentId }, { studentId: null, stationId: { in: memberships.map((m) => m.stationId) } }],
              },
              select: { activityInstanceId: true, stationId: true, studentId: true, startMs: true, endMs: true },
            }),
          ]);

    const entries: ClassActivityEntry[] = [];
    for (const m of memberships) {
      const activity = m.group.activity;
      if (!activity) continue;
      const { session } = m.group;
      const mine = recordings.filter(
        (r) =>
          r.activityInstanceId === activity.id &&
          (r.studentIds.includes(studentId) || (r.studentIds.length === 0 && r.stationId === m.stationId)),
      );
      // Older turns (chairman turns before they were stamped) name no student:
      // they count by the seat this student sat at in the group.
      const myTurns = turns.filter(
        (t) => t.activityInstanceId === activity.id && (t.studentId === studentId || (t.studentId === null && t.stationId === m.stationId)),
      );
      entries.push({
        sessionId: session.id,
        sessionTitle: session.title,
        sessionState: session.state,
        date: (session.startedAt ?? session.createdAt).toISOString(),
        groupIndex: m.group.index,
        activityType: activity.type,
        activityLabel: labelFor(activity.type),
        topic: topicOf(activity.config),
        role: m.role as SessionRole,
        groupmates: m.group.members.flatMap((o) =>
          o.studentId && o.studentId !== studentId && o.student ? [o.student.fullName] : [],
        ),
        recordings: mine.map((r) => ({
          id: r.id,
          kind: r.kind as RecordingKind,
          status: r.status,
          durationMs: r.durationMs,
          createdAt: r.createdAt.toISOString(),
        })),
        roundTable:
          activity.type === 'ROUND_TABLE'
            ? { turns: myTurns.length, speakingMs: myTurns.reduce((n, t) => n + Math.max(0, t.endMs - t.startMs), 0) }
            : null,
      });
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date) || a.groupIndex - b.groupIndex);
  }

  /** The teacher's own recordings of the whole class broadcast (see
   * BroadcastPanel's Record button) — same rows for every student in the
   * class, unlike `activities`' per-student recordings, because there is
   * only ever one "the class" to have recorded. Scoped through the live
   * class's batchId, not per-session, so a recording made from an ad-hoc
   * Lab Control class (no batchId) is simply never linked to any batch
   * and never shows up here — consistent with such a class having no My
   * Classes entry either. A 'failed' row (nothing ever captured) is left
   * out; nothing to play back and not worth a student's confusion. */
  private async classRecordings(batchId: string): Promise<ClassRecordingHistoryEntry[]> {
    const rows = await this.prisma.recording.findMany({
      where: { kind: RecordingKind.CLASS_BROADCAST, liveClass: { batchId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, withAudio: true, durationMs: true, status: true, updatedAt: true, createdAt: true, liveClass: { select: { title: true } } },
    });
    const now = Date.now();
    return rows
      .map((r) => ({ ...r, derivedStatus: deriveClassRecordingStatus(r, now) }))
      .filter((r) => r.derivedStatus !== 'failed')
      .map((r) => ({
        id: r.id,
        classTitle: r.liveClass?.title ?? null,
        withAudio: r.withAudio ?? false,
        durationMs: r.durationMs,
        status: r.derivedStatus as 'recording' | 'ready' | 'incomplete',
        createdAt: r.createdAt.toISOString(),
      }));
  }

  private async assignments(studentId: string, batchId: string): Promise<ClassAssignmentEntry[]> {
    const rows = await this.prisma.assignment.findMany({
      where: { studentId, batchId },
      select: {
        id: true,
        dueAt: true,
        createdAt: true,
        exercise: { select: { title: true, type: true } },
        attempts: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            status: true,
            rawScore: true,
            maxScore: true,
            submittedAt: true,
            revealAt: true,
            scoreOverride: { select: { reason: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return rows.map((a) => {
      const latest = a.attempts[0];
      const reason = latest?.scoreOverride?.reason;
      // SPEC-mcq-test-timed-reveal.md — a class-history entry is the same
      // "must never carry the answer key/score before reveal" wire the
      // student's own AssignmentsPanel is, so it gets the same mask:
      // SCORED but not yet revealed reads as SUBMITTED with no score.
      const pending =
        latest &&
        a.exercise.type === ActivityType.VOCABULARY_TEST &&
        latest.status === AttemptStatus.SCORED &&
        (latest.revealAt === null || latest.revealAt > now);
      return {
        assignmentId: a.id,
        title: a.exercise.title,
        type: a.exercise.type,
        typeLabel: labelFor(a.exercise.type),
        dueAt: a.dueAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        latestAttempt: latest
          ? {
              status: pending ? AttemptStatus.SUBMITTED : (latest.status as AttemptStatus),
              percent:
                !pending && latest.rawScore !== null && latest.maxScore
                  ? Math.round((latest.rawScore / latest.maxScore) * 100)
                  : null,
              submittedAt: latest.submittedAt?.toISOString() ?? null,
              feedback: !pending && reason && reason !== NO_WRITTEN_FEEDBACK ? reason : null,
            }
          : null,
      };
    });
  }
}
