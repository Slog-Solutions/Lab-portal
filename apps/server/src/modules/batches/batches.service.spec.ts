import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { BatchErrorCode, EnrollmentSource, UserRole, zBatchCode } from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { UNAMBIGUOUS_ALPHABET } from '../../common/random-code';
import { BatchAccessService } from './batch-access.service';
import { BatchesService } from './batches.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Same no-Nest-DI style as stations.service.spec.ts: plain `vi.fn()` model
 * fakes, services built directly. BatchAccessService is the REAL one over
 * the fake Prisma, on purpose — "a teacher may only touch a class they
 * teach" must be proven against the actual ownership lookup, not against a
 * mock that simply says yes.
 */
function makeFakePrisma() {
  return {
    batch: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    batchTeacher: { findUnique: vi.fn(), findMany: vi.fn() },
    enrollment: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  };
}

function makeFakeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, audit: ReturnType<typeof makeFakeAudit>): BatchesService {
  const access = new BatchAccessService(prisma as unknown as PrismaService);
  return new BatchesService(prisma as unknown as PrismaService, access, audit as unknown as AuditService);
}

function prismaError(code: 'P2002' | 'P2025'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '6.19.3', meta: { target: ['code'] } });
}

const student: JwtPayload = { sub: 'stu1', role: UserRole.STUDENT, serviceNumber: 'S-1' };
const teacherA: JwtPayload = { sub: 'teacherA', role: UserRole.TEACHER, serviceNumber: 'T-A' };
const admin: JwtPayload = { sub: 'admin1', role: UserRole.ADMIN, serviceNumber: 'A-1' };

const SECRET_KEY = 'Alpha-2026';
const batchRow = { id: 'batch1', code: 'ACTC-B01', name: 'ACTC Batch 1', joinKey: SECRET_KEY, joinOpen: true };

/** Runs `fn` and returns the HttpException it throws (fails the test if it doesn't). */
async function thrown(fn: () => Promise<unknown>): Promise<HttpException> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error('expected the call to throw');
}

/** Everything ever handed to audit.log, stringified — for "the key never reaches the audit trail". */
function auditDump(audit: ReturnType<typeof makeFakeAudit>): string {
  return JSON.stringify(audit.log.mock.calls);
}

describe('BatchesService.joinByCode', () => {
  it('enrols a student who presents the right code and key', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue(batchRow);
    prisma.enrollment.findUnique.mockResolvedValue(null);
    prisma.enrollment.create.mockResolvedValue({});
    const audit = makeFakeAudit();

    const result = await makeService(prisma, audit).joinByCode(student, { code: 'ACTC-B01', joinKey: SECRET_KEY });

    expect(result).toEqual({ ok: true, alreadyEnrolled: false, batch: { id: 'batch1', code: 'ACTC-B01', name: 'ACTC Batch 1' } });
    expect(prisma.enrollment.create).toHaveBeenCalledWith({ data: { userId: 'stu1', batchId: 'batch1', source: EnrollmentSource.SELF_JOIN } });
  });

  it('is idempotent: joining again returns the existing enrolment and creates no second row', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue(batchRow);
    prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr1' });

    const result = await makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: SECRET_KEY });

    expect(result).toMatchObject({ ok: true, alreadyEnrolled: true });
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
  });

  it('treats a concurrent-join unique violation as already enrolled, not a 500', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue(batchRow);
    prisma.enrollment.findUnique.mockResolvedValue(null);
    prisma.enrollment.create.mockRejectedValue(prismaError('P2002'));

    const result = await makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: SECRET_KEY });

    expect(result).toMatchObject({ ok: true, alreadyEnrolled: true });
  });

  it('answers an unknown code and a wrong key with byte-identical errors (no code-existence oracle)', async () => {
    const unknownPrisma = makeFakePrisma();
    unknownPrisma.batch.findUnique.mockResolvedValue(null);
    const wrongKeyPrisma = makeFakePrisma();
    wrongKeyPrisma.batch.findUnique.mockResolvedValue(batchRow);

    const unknown = await thrown(() => makeService(unknownPrisma, makeFakeAudit()).joinByCode(student, { code: 'NOPE-999', joinKey: 'whatever1' }));
    const wrongKey = await thrown(() => makeService(wrongKeyPrisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: 'not-the-key' }));

    expect(unknown.getStatus()).toBe(401);
    expect(wrongKey.getStatus()).toBe(unknown.getStatus());
    expect(JSON.stringify(wrongKey.getResponse())).toBe(JSON.stringify(unknown.getResponse()));
    expect(unknown.getResponse()).toMatchObject({ code: BatchErrorCode.JOIN_INVALID });
  });

  it('still records WHICH of the two it was, internally, and never logs the key', async () => {
    const prisma = makeFakePrisma();
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit);

    prisma.batch.findUnique.mockResolvedValueOnce(null);
    await thrown(() => service.joinByCode(student, { code: 'NOPE-999', joinKey: 'guess-one' }));
    prisma.batch.findUnique.mockResolvedValueOnce(batchRow);
    await thrown(() => service.joinByCode(student, { code: 'ACTC-B01', joinKey: 'guess-two' }));

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'batch.join_failed', detail: expect.objectContaining({ reason: 'unknown_code' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'batch.join_failed', detail: expect.objectContaining({ reason: 'bad_key' }) }));
    const dump = auditDump(audit);
    for (const secret of [SECRET_KEY, 'guess-one', 'guess-two']) expect(dump).not.toContain(secret);
  });

  it('rejects a closed class with 409 BATCH_JOIN_CLOSED (only reachable with the right code AND key)', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue({ ...batchRow, joinOpen: false });
    prisma.enrollment.findUnique.mockResolvedValue(null);

    const err = await thrown(() => makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: SECRET_KEY }));

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: BatchErrorCode.JOIN_CLOSED });
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
  });

  it('does not reveal "closed" to someone with the wrong key — that is still the uniform invalid error', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue({ ...batchRow, joinOpen: false });

    const err = await thrown(() => makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: 'not-the-key' }));

    expect(err.getStatus()).toBe(401);
    expect(err.getResponse()).toMatchObject({ code: BatchErrorCode.JOIN_INVALID });
  });

  it('never tells a student who is already enrolled that the class is closed to them', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue({ ...batchRow, joinOpen: false });
    prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr1' });

    const result = await makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: SECRET_KEY });

    expect(result).toMatchObject({ ok: true, alreadyEnrolled: true });
  });

  it('matches the code case-insensitively (trim + uppercase)', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue(batchRow);
    prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr1' });

    await makeService(prisma, makeFakeAudit()).joinByCode(student, { code: '  actc-b01 ', joinKey: SECRET_KEY });

    expect(prisma.batch.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'ACTC-B01' } }));
  });

  it('matches the key case-SENSITIVELY', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findUnique.mockResolvedValue(batchRow);

    const err = await thrown(() => makeService(prisma, makeFakeAudit()).joinByCode(student, { code: 'ACTC-B01', joinKey: 'alpha-2026' }));

    expect(err.getStatus()).toBe(401);
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['TEACHER', teacherA],
    ['ADMIN', admin],
  ])('rejects a %s caller with 403 before touching the database', async (_label, caller) => {
    const prisma = makeFakePrisma();

    const err = await thrown(() => makeService(prisma, makeFakeAudit()).joinByCode(caller, { code: 'ACTC-B01', joinKey: SECRET_KEY }));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.batch.findUnique).not.toHaveBeenCalled();
  });
});

describe('BatchesService.createForTeacher', () => {
  const created = { id: 'newbatch', code: 'X', name: 'X', joinKey: 'k', joinOpen: true, _count: { enrollments: 0, teachers: 1 } };

  it('links the creating teacher in the same write as the batch', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockResolvedValue(created);

    await makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Morning English', joinOpen: true }, teacherA);

    expect(prisma.batch.create).toHaveBeenCalledTimes(1);
    expect(prisma.batch.create.mock.calls[0]![0].data.teachers).toEqual({ create: { teacherId: 'teacherA' } });
  });

  it('generates a code from the name and an 8-char unambiguous key when both are omitted', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockResolvedValue(created);

    await makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Morning English', joinOpen: true }, teacherA);

    const data = prisma.batch.create.mock.calls[0]![0].data;
    expect(data.code).toMatch(/^MORNING-ENGLISH-[A-Z2-9]{4}$/);
    expect(zBatchCode.safeParse(data.code).success).toBe(true);
    expect(data.joinKey).toHaveLength(8);
    for (const ch of data.joinKey as string) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    expect(data.joinOpen).toBe(true);
  });

  it('keeps a teacher-typed code (normalised to uppercase) and key', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockResolvedValue(created);

    await makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Evening', code: ' evening-01 ', joinKey: ' Bravo-2026 ', joinOpen: false }, teacherA);

    expect(prisma.batch.create.mock.calls[0]![0].data).toMatchObject({ code: 'EVENING-01', joinKey: 'Bravo-2026', joinOpen: false });
  });

  it('retries a generated code that collides, then succeeds', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockRejectedValueOnce(prismaError('P2002')).mockRejectedValueOnce(prismaError('P2002')).mockResolvedValue(created);

    const result = await makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Morning English', joinOpen: true }, teacherA);

    expect(result).toBe(created);
    expect(prisma.batch.create).toHaveBeenCalledTimes(3);
  });

  it('gives up with 409 after 5 generated-code collisions', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockRejectedValue(prismaError('P2002'));

    await expect(makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Morning English', joinOpen: true }, teacherA)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.batch.create).toHaveBeenCalledTimes(5);
  });

  it('does not retry a code the teacher typed themselves: an immediate 409', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockRejectedValue(prismaError('P2002'));

    await expect(
      makeService(prisma, makeFakeAudit()).createForTeacher({ name: 'Evening', code: 'TAKEN-01', joinOpen: true }, teacherA),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.batch.create).toHaveBeenCalledTimes(1);
  });

  it('audits the creation without the join key', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.create.mockResolvedValue(created);
    const audit = makeFakeAudit();

    await makeService(prisma, audit).createForTeacher({ name: 'Evening', joinKey: 'Bravo-2026', joinOpen: true }, teacherA);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'teacherA', action: 'batch.create' }));
    expect(auditDump(audit)).not.toContain('Bravo-2026');
  });
});

describe('BatchesService.update — who may change what', () => {
  it('rejects a teacher renaming a class they do NOT teach (403, nothing written)', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue(null); // no BatchTeacher row for teacherA + batch1

    await expect(makeService(prisma, makeFakeAudit()).update('batch1', { name: 'Hijacked' }, teacherA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it('decides ownership by looking the link up in the database, not from the token', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.batch.update.mockResolvedValue({ id: 'batch1' });

    await makeService(prisma, makeFakeAudit()).update('batch1', { name: 'Renamed' }, teacherA);

    expect(prisma.batchTeacher.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchId_teacherId: { batchId: 'batch1', teacherId: 'teacherA' } } }),
    );
  });

  it('lets a teacher change name, joinKey and joinOpen of their own class', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.batch.update.mockResolvedValue({ id: 'batch1' });

    await makeService(prisma, makeFakeAudit()).update('batch1', { name: 'Renamed', joinKey: 'Charlie-2026', joinOpen: false }, teacherA);

    expect(prisma.batch.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'batch1' }, data: { name: 'Renamed', joinKey: 'Charlie-2026', joinOpen: false } }),
    );
  });

  it('refuses a teacher changing the code, even on their own class', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });

    await expect(makeService(prisma, makeFakeAudit()).update('batch1', { code: 'NEW-CODE' }, teacherA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it('lets an ADMIN change the code of any class, without an ownership lookup', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.update.mockResolvedValue({ id: 'batch1' });

    await makeService(prisma, makeFakeAudit()).update('batch1', { code: 'new-code' }, admin);

    expect(prisma.batchTeacher.findUnique).not.toHaveBeenCalled();
    expect(prisma.batch.update).toHaveBeenCalledWith(expect.objectContaining({ data: { code: 'NEW-CODE' } }));
  });

  it('audits the names of the changed fields, never the values', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.batch.update.mockResolvedValue({ id: 'batch1' });
    const audit = makeFakeAudit();

    await makeService(prisma, audit).update('batch1', { joinKey: 'Charlie-2026' }, teacherA);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ detail: { batchId: 'batch1', changed: ['joinKey'] } }));
    expect(auditDump(audit)).not.toContain('Charlie-2026');
  });
});

describe('BatchesService.regenerateKey', () => {
  it('issues a fresh 8-char key for the class teacher and stores it', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.batch.update.mockResolvedValue({});

    const { joinKey } = await makeService(prisma, makeFakeAudit()).regenerateKey('batch1', teacherA);

    expect(joinKey).toHaveLength(8);
    for (const ch of joinKey) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    expect(prisma.batch.update).toHaveBeenCalledWith({ where: { id: 'batch1' }, data: { joinKey } });
  });

  it('never writes the new key to the audit trail', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.batch.update.mockResolvedValue({});
    const audit = makeFakeAudit();

    const { joinKey } = await makeService(prisma, audit).regenerateKey('batch1', teacherA);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'batch.key_regenerated', detail: { batchId: 'batch1' } }));
    expect(auditDump(audit)).not.toContain(joinKey);
  });

  it('refuses a teacher who does not teach the class', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue(null);

    await expect(makeService(prisma, makeFakeAudit()).regenerateKey('batch1', teacherA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it('reports a missing class as 404 for an ADMIN', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.update.mockRejectedValue(prismaError('P2025'));

    await expect(makeService(prisma, makeFakeAudit()).regenerateKey('gone', admin)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BatchesService.unenrollStudent', () => {
  it('lets the class teacher remove a student', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue({ id: 'link1' });
    prisma.enrollment.deleteMany.mockResolvedValue({ count: 1 });

    await makeService(prisma, makeFakeAudit()).unenrollStudent('batch1', 'stu1', teacherA);

    expect(prisma.enrollment.deleteMany).toHaveBeenCalledWith({ where: { batchId: 'batch1', userId: 'stu1' } });
  });

  it('refuses a teacher who does not teach the class', async () => {
    const prisma = makeFakePrisma();
    prisma.batchTeacher.findUnique.mockResolvedValue(null);

    await expect(makeService(prisma, makeFakeAudit()).unenrollStudent('batch1', 'stu1', teacherA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.enrollment.deleteMany).not.toHaveBeenCalled();
  });
});

describe('BatchesService.listMine', () => {
  const row = {
    id: 'batch1',
    code: 'ACTC-B01',
    name: 'ACTC Batch 1',
    joinOpen: true,
    teachers: [{ teacher: { fullName: 'Teacher One' } }, { teacher: { fullName: 'Teacher Two' } }],
    _count: { enrollments: 12 },
  };

  it('returns an empty list for a student who is in no class', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findMany.mockResolvedValue([]);

    expect(await makeService(prisma, makeFakeAudit()).listMine(student)).toEqual([]);
  });

  it('never selects joinKey for a student, and their rows have no joinKey property at all', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findMany.mockResolvedValue([row]);

    const result = await makeService(prisma, makeFakeAudit()).listMine(student);

    const args = prisma.batch.findMany.mock.calls[0]![0];
    expect(args.select).not.toHaveProperty('joinKey');
    expect(args.where).toEqual({ enrollments: { some: { userId: 'stu1' } } });
    expect(result[0]).not.toHaveProperty('joinKey');
    expect(JSON.stringify(result)).not.toContain('joinKey');
  });

  it('maps teacher names and the student count', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findMany.mockResolvedValue([row]);

    const [view] = await makeService(prisma, makeFakeAudit()).listMine(student);

    expect(view).toEqual({ id: 'batch1', code: 'ACTC-B01', name: 'ACTC Batch 1', joinOpen: true, teacherNames: ['Teacher One', 'Teacher Two'], studentCount: 12 });
  });

  it('gives a teacher the classes they teach, WITH the join key', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findMany.mockResolvedValue([{ ...row, joinKey: SECRET_KEY }]);

    const [view] = await makeService(prisma, makeFakeAudit()).listMine(teacherA);

    expect(prisma.batch.findMany.mock.calls[0]![0].where).toEqual({ teachers: { some: { teacherId: 'teacherA' } } });
    expect(view).toMatchObject({ joinKey: SECRET_KEY });
  });

  it('gives an admin every class, with the join key', async () => {
    const prisma = makeFakePrisma();
    prisma.batch.findMany.mockResolvedValue([{ ...row, joinKey: SECRET_KEY }]);

    const [view] = await makeService(prisma, makeFakeAudit()).listMine(admin);

    expect(prisma.batch.findMany.mock.calls[0]![0].where).toEqual({});
    expect(view).toMatchObject({ joinKey: SECRET_KEY });
  });
});
