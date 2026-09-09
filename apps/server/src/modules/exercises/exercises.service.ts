import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type ActivityType, type CreateExerciseDto, type ItemDto } from '@lab/shared';
import type { Prisma } from '../../../generated/prisma';
// Importing from the activities subpath (rather than the root) is
// deliberate and load-bearing: @lab/shared's root index does NOT
// re-export it (registration has a side effect, kept explicit), and this
// import is what first actually exercises the registry server-side —
// every configSchema existed before this module but nothing ever called
// getActivity() against real data (verified by grep during Phase 3 recon).
import { getActivity } from '@lab/shared/activities';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Exercise authoring + item bank (Ser 4, Ser 5, Ser 10). This is also
 * where the Activity Type Registry (packages/shared/src/activities)
 * actually gets consumed for the first time — until this module, every
 * ActivityDescriptor.configSchema was written but never run against real
 * data (verified by grep during the Phase 3 exploration pass: zero
 * non-package call sites). A teacher's authored `config` is now validated
 * against that activity type's own schema at creation and every update,
 * the way the registry's own doc comment always said it would be.
 */
@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(teacherId: string, dto: CreateExerciseDto) {
    const config = this.validateConfig(dto.type, dto.config);
    const exercise = await this.prisma.exercise.create({
      data: { teacherId, type: dto.type, title: dto.title, lessonId: dto.lessonId, config: config as Prisma.InputJsonValue },
    });
    await this.audit.log({ actorId: teacherId, action: 'exercise.create', detail: { exerciseId: exercise.id, type: dto.type } });
    return exercise;
  }

  /** Reads are lab-wide — exercises are shared teaching material, only
   * mutation is owner/admin-restricted (see class doc comment). */
  async list() {
    return this.prisma.exercise.findMany({
      orderBy: { createdAt: 'desc' },
      include: { itemBank: { select: { id: true, _count: { select: { items: true } } } } },
    });
  }

  async get(id: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: { itemBank: { include: { items: { orderBy: { order: 'asc' } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercise not found');
    return exercise;
  }

  async update(id: string, patch: { title?: string; config?: unknown }, requester: { id: string; role: string }) {
    const exercise = await this.get(id);
    this.assertOwnerOrAdmin(exercise, requester);
    const config = patch.config !== undefined ? this.validateConfig(exercise.type, patch.config) : undefined;
    const updated = await this.prisma.exercise.update({
      where: { id },
      data: { title: patch.title, config: config as Prisma.InputJsonValue | undefined },
    });
    await this.audit.log({ actorId: requester.id, action: 'exercise.update', detail: { exerciseId: id } });
    return updated;
  }

  async remove(id: string, requester: { id: string; role: string }): Promise<void> {
    const exercise = await this.get(id);
    this.assertOwnerOrAdmin(exercise, requester);
    await this.prisma.exercise.delete({ where: { id } });
    await this.audit.log({ actorId: requester.id, action: 'exercise.delete', detail: { exerciseId: id } });
  }

  /** Bulk-replaces the exercise's item bank — the manual authoring path. */
  async setItems(exerciseId: string, items: ItemDto[], requester: { id: string; role: string }) {
    const exercise = await this.get(exerciseId);
    this.assertOwnerOrAdmin(exercise, requester);
    const bank = await this.ensureItemBank(exerciseId);
    await this.prisma.item.deleteMany({ where: { itemBankId: bank.id } });
    await this.prisma.item.createMany({
      data: items.map((item, index) => ({ ...item, itemBankId: bank.id, order: index })),
    });
    await this.audit.log({ actorId: requester.id, action: 'exercise.set_items', detail: { exerciseId, count: items.length } });
    return this.listItems(exerciseId, requester);
  }

  /** Word-list import (Ser 5) — same underlying table, `append` decides
   * whether to add to or replace the existing bank. */
  async importItems(exerciseId: string, items: ItemDto[], append: boolean, requester: { id: string; role: string }) {
    const exercise = await this.get(exerciseId);
    this.assertOwnerOrAdmin(exercise, requester);
    const bank = await this.ensureItemBank(exerciseId);
    const startOrder = append ? await this.prisma.item.count({ where: { itemBankId: bank.id } }) : 0;
    if (!append) await this.prisma.item.deleteMany({ where: { itemBankId: bank.id } });
    await this.prisma.item.createMany({
      data: items.map((item, index) => ({ ...item, itemBankId: bank.id, order: startOrder + index })),
    });
    await this.audit.log({
      actorId: requester.id,
      action: 'exercise.import_items',
      detail: { exerciseId, count: items.length, append },
    });
    return this.listItems(exerciseId, requester);
  }

  async listItems(exerciseId: string, requester: { id: string; role: string }) {
    const exercise = await this.get(exerciseId);
    this.assertOwnerOrAdmin(exercise, requester);
    if (!exercise.itemBank) return [];
    return this.prisma.item.findMany({ where: { itemBankId: exercise.itemBank.id }, orderBy: { order: 'asc' } });
  }

  private async ensureItemBank(exerciseId: string) {
    const existing = await this.prisma.itemBank.findUnique({ where: { exerciseId } });
    if (existing) return existing;
    return this.prisma.itemBank.create({ data: { exerciseId } });
  }

  private validateConfig(type: ActivityType, config: unknown): unknown {
    const descriptor = getActivity(type);
    const result = descriptor.configSchema.safeParse(config);
    if (!result.success) {
      throw new BadRequestException({
        message: `Invalid config for activity type ${type}`,
        issues: result.error.issues,
      });
    }
    return result.data;
  }

  private assertOwnerOrAdmin(exercise: { teacherId: string }, requester: { id: string; role: string }): void {
    if (requester.role === UserRole.ADMIN || exercise.teacherId === requester.id) return;
    throw new ForbiddenException('Only the authoring teacher or an admin may modify this exercise');
  }
}
