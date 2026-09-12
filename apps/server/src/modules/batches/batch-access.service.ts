import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Single authority for "which batches may this principal use" (LMS admin
 * core). ADMIN bypasses everywhere; a TEACHER must hold a BatchTeacher
 * row for the batch in question. Deliberately centralized here rather
 * than re-checked ad hoc in SessionsService/BatchesController, so the
 * rule has exactly one home.
 *
 * Deliberate non-goals (do not extend this service to cover these
 * without discussing — each is a considered decision):
 *  - GET /users?role=STUDENT stays globally unscoped. It feeds
 *    GradebookPage's assignment picker and ReportsPage's filters;
 *    scoping it to "students enrolled in my batches" would silently
 *    shrink both the moment a batch assignment is incomplete. Batch-
 *    scoped rosters are served instead by BatchesService.listStudents.
 *  - Gradebook/Reports (Assignment, Attempt) stay unscoped. Neither
 *    table has a batchId column, and scoping through Enrollment is
 *    ambiguous now that a student can belong to more than one batch
 *    (self-join) — doing that correctly is its own design pass.
 *  - StationsService.claim stays enrollment-agnostic — it's documented
 *    as "a roster pick, not a login", and gating it on enrollment would
 *    strand a student at a real seat over an admin data-entry gap.
 */
@Injectable()
export class BatchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Batch ids a TEACHER may use; ADMIN gets `null`, meaning "no filter". */
  async batchIdsForTeacher(teacherId: string): Promise<string[]> {
    const rows = await this.prisma.batchTeacher.findMany({
      where: { teacherId },
      select: { batchId: true },
    });
    return rows.map((r) => r.batchId);
  }

  /** Throws unless `user` is ADMIN or is assigned to `batchId`. */
  async assertCanUseBatch(user: JwtPayload, batchId: string): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    if (user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('Only staff may act on a batch');
    }
    const assignment = await this.prisma.batchTeacher.findUnique({
      where: { batchId_teacherId: { batchId, teacherId: user.sub } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this batch');
    }
  }
}
