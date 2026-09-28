import { describe, expect, it } from 'vitest';
import { groupCountFor, previewGroupSizes, validateRoundTableSetup } from './round-table.js';

describe('previewGroupSizes (the authoring preview == the server split)', () => {
  it('20 students at size 5 -> 4 groups of 5', () => {
    expect(previewGroupSizes(20, 5)).toEqual([5, 5, 5, 5]);
  });

  it('sizes differ by at most one, largest first', () => {
    expect(previewGroupSizes(11, 4)).toEqual([4, 4, 3]);
    expect(previewGroupSizes(5, 2)).toEqual([3, 2]); // never a group of 1
  });

  it('caps at the free group slots and at 6 overall', () => {
    expect(previewGroupSizes(40, 2)).toHaveLength(6);
    expect(previewGroupSizes(40, 2, 3)).toHaveLength(3);
  });

  it('is empty when there is nobody to pair up', () => {
    expect(previewGroupSizes(1, 4)).toEqual([]);
    expect(previewGroupSizes(0, 4)).toEqual([]);
  });

  it('groupCountFor never exceeds floor(n/2), so every group has >= 2', () => {
    for (let n = 2; n <= 40; n++) for (const size of [2, 3, 5, 10]) expect(Math.floor(n / groupCountFor(n, size))).toBeGreaterThanOrEqual(2);
  });
});

describe('validateRoundTableSetup (spec 7.1)', () => {
  const two = ['a', 'b'];
  const ok = (config: unknown, members = two, chairman?: string) => validateRoundTableSetup({ config, memberStationIds: members, chairmanStationId: chairman });
  const errors = (r: ReturnType<typeof ok>) => (r.ok ? [] : r.errors);

  it('a valid manual group passes and materialises defaults', () => {
    const r = ok({ topic: 'T' }, two, 'a');
    expect(r.ok && r.config).toMatchObject({ participantAssignment: 'manual', chairmanAssignment: 'manual', micRequestQueueEnabled: true });
  });

  it('needs at least 2 participants and a topic', () => {
    expect(errors(ok({ topic: 'T' }, ['a'], 'a')).join()).toMatch(/at least 2/);
    expect(ok({ topic: '' }, two, 'a').ok).toBe(false);
  });

  it('a manual chairman must be exactly one of the members', () => {
    expect(errors(ok({ topic: 'T' }, two)).join()).toMatch(/pick exactly one chairman/);
    expect(errors(ok({ topic: 'T' }, two, 'zzz')).join()).toMatch(/pick exactly one chairman/);
  });

  it('automatic grouping needs a target size and an automatic chairman; the chairman then needs no pick', () => {
    expect(errors(ok({ topic: 'T', participantAssignment: 'automatic', chairmanAssignment: 'automatic' })).join()).toMatch(/target group size/);
    expect(errors(ok({ topic: 'T', participantAssignment: 'automatic', targetGroupSize: 4 }, two, 'a')).join()).toMatch(/automatic chairman/);
    expect(ok({ topic: 'T', participantAssignment: 'automatic', targetGroupSize: 4, chairmanAssignment: 'automatic' }).ok).toBe(true);
  });

  it('a rotating chair needs an interval of at least 60s', () => {
    expect(errors(ok({ topic: 'T', chairmanAssignment: 'automatic', chairmanStrategy: 'rotate' })).join()).toMatch(/interval/);
    expect(ok({ topic: 'T', chairmanAssignment: 'automatic', chairmanStrategy: 'rotate', rotateEverySec: 120 }).ok).toBe(true);
    expect(ok({ topic: 'T', chairmanAssignment: 'automatic', chairmanStrategy: 'rotate', rotateEverySec: 30 }).ok).toBe(false);
  });
});
