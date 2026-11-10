import { describe, expect, it } from 'vitest';
import { buildAllocation, type AllocationInput } from './allocation-job';
import { mondayOf, todayIn, weekRange } from './dates';

const base = (over: Partial<AllocationInput> = {}): AllocationInput => ({
  household: { id: 'h', timezone: 'America/Los_Angeles', allocation_mode: 'workload', missed_weight_pct: 50 },
  members: [
    { id: 'a', rotation_position: 0, status: 'active', move_out_on: null },
    { id: 'b', rotation_position: 1, status: 'active', move_out_on: null },
    { id: 'c', rotation_position: 2, status: 'archived', move_out_on: null },
  ],
  chores: [
    { id: 'bath', name: 'Clean bathroom', effort: 5, frequency: 'weekly', sort_order: 0, active: true },
    { id: 'dish', name: 'Dishes', effort: 2, frequency: 'daily', sort_order: 1, active: true },
    { id: 'old', name: 'Retired chore', effort: 4, frequency: 'daily', sort_order: 2, active: false },
  ],
  workload: [{ member_id: 'a', load_points: '10.50' }, { member_id: 'b', load_points: '4.00' }],
  preferences: [],
  absences: [],
  firstPeriodStartsOn: null,
  // Monday 2026-11-09, 08:00 in Los Angeles.
  now: new Date('2026-11-09T16:00:00Z'),
  ...over,
});

describe('dates', () => {
  it('uses the household time zone for "today" and Monday', () => {
    const lateSundayLA = new Date('2026-11-16T06:30:00Z'); // still Sunday the 15th in LA
    expect(todayIn('America/Los_Angeles', lateSundayLA)).toBe('2026-11-15');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(weekRange('2026-11-30')).toBe('Nov 30 – Dec 6');
  });
});

describe('buildAllocation', () => {
  it('shares out every active chore instance for the week, starting Monday', () => {
    const plan = buildAllocation(base());
    expect(plan.startsOn).toBe('2026-11-09');
    expect(plan.tasks).toHaveLength(1 + 7);
    expect(plan.tasks.every((t) => t.chore_id !== 'old')).toBe(true);
    expect(plan.tasks.every((t) => t.member_id !== 'c')).toBe(true);
    expect(plan.boundHeld).toBe(true);
  });

  it('balances on load_points, including fractions from missed chores', () => {
    const plan = buildAllocation(base());
    expect(plan.tasks.find((t) => t.chore_id === 'bath')!.member_id).toBe('b');
  });

  it('respects absences and move-out dates', () => {
    const plan = buildAllocation(base({
      absences: [{ member_id: 'b', kind: 'day_off', starts_on: '2026-11-10', ends_on: '2026-11-11' }],
      members: [
        { id: 'a', rotation_position: 0, status: 'active', move_out_on: null },
        { id: 'b', rotation_position: 1, status: 'moving_out', move_out_on: '2026-11-14' },
      ],
    }));
    const bDays = plan.tasks.filter((t) => t.member_id === 'b').map((t) => t.due_on);
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-14', '2026-11-15']) expect(bDays).not.toContain(d);
  });

  it('starting mid-week only creates chores from today on', () => {
    const plan = buildAllocation(base({ now: new Date('2026-11-12T18:00:00Z') })); // Thursday in LA
    expect(plan.tasks.every((t) => t.due_on >= '2026-11-12')).toBe(true);
    expect(plan.skippedPastDays).toBeGreaterThan(0);
  });

  it('gives a member back from a trip a rejoin baseline (US-34)', () => {
    const plan = buildAllocation(base({
      workload: [{ member_id: 'a', load_points: 40 }, { member_id: 'b', load_points: 12 }],
      absences: [{ member_id: 'b', kind: 'vacation', starts_on: '2026-10-26', ends_on: '2026-11-08' }],
    }));
    expect(plan.adjustments).toEqual([{ member_id: 'b', points: 28, reason: 'rejoin_baseline' }]);
  });

  it('uses rotation when the household chose it', () => {
    const plan = buildAllocation(base({ household: { id: 'h', timezone: 'UTC', allocation_mode: 'rotation', missed_weight_pct: 50 } }));
    expect(plan.mode).toBe('rotation');
    expect(new Set(plan.tasks.map((t) => t.reason))).toEqual(new Set(['rotation']));
  });

  it('is deterministic', () => {
    expect(buildAllocation(base())).toEqual(buildAllocation(base()));
  });
});
