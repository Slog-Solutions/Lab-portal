import { describe, expect, it, vi } from 'vitest';
import { AttemptStatus, type AssignmentDto } from '@lab/shared';
import { GradebookService } from './gradebook.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

const STUDENTS = ['clh3am1r30000qzrmn831i7a', 'clh3am1r30000qzrmn831i7b'];
const TEACHER_USER: JwtPayload = { sub: 'teacher1', role: 'TEACHER', serviceNumber: 'TCH-1' };

function makePrisma() {
  return {
    user: { findMany: vi.fn().mockResolvedValue(STUDENTS.map((id) => ({ id }))) },
    assignment: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    enrollment: { count: vi.fn().mockResolvedValue(STUDENTS.length) },
  };
}

function makeSvc(prisma: ReturnType<typeof makePrisma>) {
  const audit = { log: vi.fn() };
  const batchAccess = { assertCanUseBatch: vi.fn().mockResolvedValue(undefined) };
  return {
    svc: new GradebookService(prisma as unknown as PrismaService, audit as unknown as AuditService, batchAccess as unknown as BatchAccessService),
    audit,
    batchAccess,
  };
}

const dto = (over: Partial<AssignmentDto> = {}): AssignmentDto => ({
  studentIds: STUDENTS,
  exerciseIds: ['ex1'],
  ...over,
});

describe('GradebookService.createAssignments', () => {
  it('creates one row per (student, exercise) pair and audits it', async () => {
    const prisma = makePrisma();
    const { svc, audit } = makeSvc(prisma);

    const result = await svc.createAssignments(TEACHER_USER, dto());

    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(prisma.assignment.createMany).toHaveBeenCalledWith({
      data: STUDENTS.map((studentId) => ({
        teacherId: 'teacher1',
        studentId,
        exerciseId: 'ex1',
        targetScore: undefined,
        allocatedHours: undefined,
        dueAt: undefined,
        batchId: undefined,
      })),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'assignment.create' }));
  });

  it('refuses inactive or unknown students without creating anything', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: STUDENTS[0] }]); // the second one isn't an active student
    const { svc } = makeSvc(prisma);

    await expect(svc.createAssignments(TEACHER_USER, dto())).rejects.toThrow(/Not active students: clh3am1r30000qzrmn831i7b/);
    expect(prisma.assignment.createMany).not.toHaveBeenCalled();
  });

  describe('created from a class', () => {
    const CLASS_ID = 'clh3am1r30000qzrmn831c1a';

    it('checks the teacher teaches the class and files every assignment under it', async () => {
      const prisma = makePrisma();
      const { svc, batchAccess } = makeSvc(prisma);

      await svc.createAssignments(TEACHER_USER, dto({ batchId: CLASS_ID }));

      expect(batchAccess.assertCanUseBatch).toHaveBeenCalledWith(TEACHER_USER, CLASS_ID);
      expect(prisma.enrollment.count).toHaveBeenCalledWith({ where: { batchId: CLASS_ID, userId: { in: STUDENTS } } });
      const rows = prisma.assignment.createMany.mock.calls[0]![0].data as Array<{ batchId?: string }>;
      expect(rows.every((r) => r.batchId === CLASS_ID)).toBe(true);
    });

    it('refuses a student who is not in the class, writing nothing', async () => {
      const prisma = makePrisma();
      prisma.enrollment.count.mockResolvedValue(1);
      const { svc } = makeSvc(prisma);

      await expect(svc.createAssignments(TEACHER_USER, dto({ batchId: CLASS_ID }))).rejects.toThrow(/not in this class/);
      expect(prisma.assignment.createMany).not.toHaveBeenCalled();
    });

    it('does not check the roster when the assignment is not created from a class', async () => {
      const prisma = makePrisma();
      const { svc, batchAccess } = makeSvc(prisma);

      await svc.createAssignments(TEACHER_USER, dto());

      expect(batchAccess.assertCanUseBatch).not.toHaveBeenCalled();
    });
  });

  describe('duplicate suppression', () => {
    it('skips a (student, exercise) pair that already has an outstanding (unsubmitted) assignment', async () => {
      const prisma = makePrisma();
      prisma.assignment.findMany.mockResolvedValue([{ studentId: STUDENTS[0], exerciseId: 'ex1', attempts: [] }]);
      const { svc } = makeSvc(prisma);

      const result = await svc.createAssignments(TEACHER_USER, dto());

      expect(result).toEqual({ created: 1, skipped: 1 });
      const rows = prisma.assignment.createMany.mock.calls[0]![0].data as Array<{ studentId: string }>;
      expect(rows.map((r) => r.studentId)).toEqual([STUDENTS[1]]);
    });

    it('still creates a fresh row when the prior assignment was already submitted — a re-take', async () => {
      const prisma = makePrisma();
      prisma.assignment.findMany.mockResolvedValue([
        { studentId: STUDENTS[0], exerciseId: 'ex1', attempts: [{ status: AttemptStatus.SUBMITTED }] },
      ]);
      const { svc } = makeSvc(prisma);

      const result = await svc.createAssignments(TEACHER_USER, dto());

      expect(result).toEqual({ created: 2, skipped: 0 });
    });

    it('still creates a fresh row when the prior assignment was scored', async () => {
      const prisma = makePrisma();
      prisma.assignment.findMany.mockResolvedValue([
        { studentId: STUDENTS[0], exerciseId: 'ex1', attempts: [{ status: AttemptStatus.SCORED }] },
      ]);
      const { svc } = makeSvc(prisma);

      const result = await svc.createAssignments(TEACHER_USER, dto());

      expect(result).toEqual({ created: 2, skipped: 0 });
    });

    it('writes nothing when every pair is already outstanding', async () => {
      const prisma = makePrisma();
      prisma.assignment.findMany.mockResolvedValue(STUDENTS.map((studentId) => ({ studentId, exerciseId: 'ex1', attempts: [] })));
      const { svc } = makeSvc(prisma);

      const result = await svc.createAssignments(TEACHER_USER, dto());

      expect(result).toEqual({ created: 0, skipped: 2 });
      expect(prisma.assignment.createMany).not.toHaveBeenCalled();
    });
  });
});
