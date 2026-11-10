import { describe, expect, it } from 'vitest';
import { allocate, addDays, expandChores, explainAssignment, rejoinAdjustments } from '../src/index.js';
import type { Chore, Frequency, Member, Preference } from '../src/index.js';
import { mulberry32 } from '../src/simulate.js';

const P0 = { startsOn: '2026-11-09', index: 0 }; // a Monday

const chore = (id: string, effort: number, frequency: Frequency = 'weekly', sortOrder = 0): Chore =>
  ({ id, name: id, effort, frequency, sortOrder });
const member = (id: string, pos: number, extra: Partial<Member> = {}): Member =>
  ({ id, rotationPosition: pos, load: 0, unavailableDates: [], preferences: {}, ...extra });

function randomHousehold(rng: () => number, withGap = true) {
  const n = 2 + Math.floor(rng() * 7);
  const freqs: Frequency[] = ['daily', 'twice_weekly', 'weekly', 'biweekly'];
  const prefs: Preference[] = ['prefer', 'neutral', 'dislike'];
  const chores = Array.from({ length: 3 + Math.floor(rng() * 12) }, (_, i) =>
    chore(`c${i}`, 1 + Math.floor(rng() * 5), freqs[Math.floor(rng() * 4)]!, i));
  const E = Math.max(...chores.map((c) => c.effort));
  const base = Math.floor(rng() * 50);
  const members = Array.from({ length: n }, (_, i) => member(`m${i}`, i, {
    load: base + (withGap ? Math.floor(rng() * (E + 1)) : 0),
    preferences: Object.fromEntries(chores.map((c) => [c.id, prefs[Math.floor(rng() * 3)]!])),
  }));
  return { chores, members, E };
}

describe('expandChores', () => {
  it('makes the right number of instances per frequency', () => {
    const cs = [chore('d', 1, 'daily'), chore('t', 1, 'twice_weekly'), chore('w', 1, 'weekly'), chore('b', 1, 'biweekly')];
    const count = (p: typeof P0) => Object.fromEntries(['d', 't', 'w', 'b'].map((id) =>
      [id, expandChores(cs, p).filter((x) => x.choreId === id).length]));
    expect(count(P0)).toEqual({ d: 7, t: 2, w: 1, b: 1 });
    expect(count({ startsOn: '2026-11-16', index: 1 })).toEqual({ d: 7, t: 2, w: 1, b: 0 });
  });
  it('puts twice-weekly chores on Monday and Thursday', () => {
    expect(expandChores([chore('t', 2, 'twice_weekly')], P0).map((x) => x.dueOn)).toEqual(['2026-11-09', '2026-11-12']);
  });
  it('handles month and year boundaries', () => {
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('workload-aware allocation (DD-05)', () => {
  it('keeps the gap within the largest effort on 5,000 random households (US-09)', () => {
    const rng = mulberry32(42);
    for (let t = 0; t < 5000; t++) {
      const { chores, members, E } = randomHousehold(rng);
      const r = allocate('workload', chores, members, { startsOn: '2026-11-09', index: t % 4 });
      expect(r.fallbacks).toBe(0);
      expect(r.gap).toBeLessThanOrEqual(E);
      expect(r.boundHeld).toBe(true);
    }
  });

  it('never widens a gap that starts wider than E', () => {
    const rng = mulberry32(7);
    for (let t = 0; t < 2000; t++) {
      const { chores, members } = randomHousehold(rng);
      members[0]!.load += 40;
      const before = Math.max(...members.map((m) => m.load)) - Math.min(...members.map((m) => m.load));
      const r = allocate('workload', chores, members, P0);
      expect(r.gap).toBeLessThanOrEqual(before);
    }
  });

  it('is deterministic and ignores the order members are passed in (RC-11)', () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 500; t++) {
      const { chores, members } = randomHousehold(rng);
      const a = allocate('workload', chores, members, P0);
      const b = allocate('workload', [...chores].reverse(), [...members].reverse(), P0);
      expect(b.assignments.map((x) => [x.choreId, x.dueOn, x.memberId]).sort())
        .toEqual(a.assignments.map((x) => [x.choreId, x.dueOn, x.memberId]).sort());
    }
  });

  it('assigns every instance exactly once', () => {
    const { chores, members } = randomHousehold(mulberry32(3));
    const r = allocate('workload', chores, members, P0);
    expect(r.assignments.length).toBe(expandChores(chores, P0).length);
  });

  it('gives the largest chore to the lowest-loaded member', () => {
    const r = allocate('workload', [chore('big', 5), chore('small', 1, 'weekly', 1)],
      [member('a', 0, { load: 10 }), member('b', 1, { load: 4 }), member('c', 2, { load: 7 })], P0);
    expect(r.assignments.find((x) => x.choreId === 'big')!.memberId).toBe('b');
  });

  it('steers a chore away from someone who dislikes it when another member is eligible', () => {
    const r = allocate('workload', [chore('bins', 5)],
      [member('a', 0, { preferences: { bins: 'dislike' } }), member('b', 1, { load: 0 })], P0);
    expect(r.assignments[0]!.memberId).toBe('b');
  });

  it('uses a preference within the slack, but not beyond it', () => {
    // E = 5. A 2-point chore can go to anyone within 3 of the minimum.
    const cs = [chore('big', 5, 'biweekly', 0), chore('dishes', 2, 'weekly', 1)];
    const odd = { startsOn: '2026-11-16', index: 1 }; // biweekly 'big' skipped, but still sets E
    const within = allocate('workload', cs, [member('a', 0, { load: 0 }), member('b', 1, { load: 3, preferences: { dishes: 'prefer' } })], odd);
    expect(within.assignments[0]).toMatchObject({ memberId: 'b', reason: 'preference' });
    const beyond = allocate('workload', cs, [member('a', 0, { load: 0 }), member('b', 1, { load: 4, preferences: { dishes: 'prefer' } })], odd);
    expect(beyond.assignments[0]).toMatchObject({ memberId: 'a', reason: 'lowest_load' });
  });

  it('breaks exact ties by the fixed member order', () => {
    const r = allocate('workload', [chore('x', 3)], [member('b', 1), member('a', 0)], P0);
    expect(r.assignments[0]).toMatchObject({ memberId: 'a', reason: 'tie_break' });
  });

  it('never assigns on a date the member is unavailable (US-08)', () => {
    const rng = mulberry32(5);
    for (let t = 0; t < 1000; t++) {
      const { chores, members } = randomHousehold(rng);
      for (const m of members) for (let d = 0; d < 7; d++) if (rng() < 0.2) m.unavailableDates.push(addDays(P0.startsOn, d));
      for (const mode of ['workload', 'rotation'] as const) {
        for (const a of allocate(mode, chores, members, P0).assignments) {
          const m = members.find((x) => x.id === a.memberId)!;
          expect(m.unavailableDates).not.toContain(a.dueOn);
        }
      }
    }
  });

  it('falls back to the least-loaded member who is home, and counts it', () => {
    const r = allocate('workload', [chore('x', 5), chore('y', 5, 'weekly', 1)],
      [member('a', 0, { unavailableDates: ['2026-11-10'] }), member('b', 1, { load: 9 }), member('c', 2, { load: 12 })], P0);
    const y = r.assignments.find((x) => x.choreId === 'y')!;
    expect(y).toMatchObject({ memberId: 'b', reason: 'fallback_unavailable' });
    expect(r.fallbacks).toBe(1);
  });

  it('leaves out a member who is away the whole week', () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(P0.startsOn, d));
    const r = allocate('workload', [chore('x', 2, 'daily')],
      [member('a', 0), member('b', 1), member('away', 2, { unavailableDates: week })], P0);
    expect(r.assignments.some((x) => x.memberId === 'away')).toBe(false);
    expect(r.gap).toBeLessThanOrEqual(2);
  });
});

describe('returning from an absence (US-34)', () => {
  it('rejoins at the household minimum instead of owing make-up chores', () => {
    const ms = [member('a', 0, { load: 30 }), member('b', 1, { load: 34 }), member('back', 2, { load: 6, returningFromAbsence: true })];
    expect(rejoinAdjustments(ms)).toEqual([{ memberId: 'back', points: 24, reason: 'rejoin_baseline' }]);
    const r = allocate('workload', [chore('x', 3, 'daily')], ms, P0);
    expect(r.adjustments).toHaveLength(1);
    expect(r.assignments.filter((x) => x.memberId === 'back').length).toBeLessThan(7);
    expect(r.gap).toBeLessThanOrEqual(3);
  });
  it('never lowers a returning member who is already above the minimum', () => {
    expect(rejoinAdjustments([member('a', 0, { load: 5 }), member('b', 1, { load: 9, returningFromAbsence: true })])).toEqual([]);
  });
});

describe('basic rotation baseline (US-06)', () => {
  it('goes round in member order and shifts each period', () => {
    const cs = [chore('a', 1, 'weekly', 0), chore('b', 1, 'weekly', 0), chore('c', 1, 'weekly', 0)];
    const ms = [member('x', 0), member('y', 1), member('z', 2)];
    expect(allocate('rotation', cs, ms, P0).assignments.map((a) => a.memberId)).toEqual(['x', 'y', 'z']);
    expect(allocate('rotation', cs, ms, { startsOn: '2026-11-16', index: 1 }).assignments.map((a) => a.memberId)).toEqual(['y', 'z', 'x']);
  });
  it('ignores effort, so its gap can exceed E where the workload rule would not', () => {
    const cs = [chore('heavy', 5, 'weekly', 0), chore('light', 1, 'weekly', 1)];
    const ms = [member('x', 0, { load: 20 }), member('y', 1, { load: 0 })];
    expect(allocate('rotation', cs, ms, P0).boundHeld).toBe(false);
    expect(allocate('workload', cs, ms, P0).gap).toBeLessThan(allocate('rotation', cs, ms, P0).gap);
  });
});

describe('explanations (RC-18)', () => {
  it('has neutral text for every reason', () => {
    const base = { choreId: 'x', name: 'x', effort: 1, dueOn: '2026-11-09', sortOrder: 0, memberId: 'a', preference: 'neutral' as const };
    for (const reason of ['lowest_load', 'preference', 'tie_break', 'fallback_unavailable', 'rotation'] as const) {
      const text = explainAssignment({ ...base, reason });
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\b(lazy|fault|behind|owes?)\b/i);
    }
  });
});

describe('member load with missed chores (DD-05 revision)', () => {
  it('counts missed chores at half weight by default', async () => {
    const { memberLoad, DEFAULT_MISSED_WEIGHT_PCT } = await import('../src/index.js');
    expect(DEFAULT_MISSED_WEIGHT_PCT).toBe(50);
    expect(memberLoad({ confirmed: 20, adjustments: 3, missed: 5 })).toBe(25.5);
    expect(memberLoad({ confirmed: 20, adjustments: 3, missed: 5 }, 0)).toBe(23);
    expect(memberLoad({ confirmed: 20, adjustments: 3, missed: 5 }, 100)).toBe(28);
    expect(() => memberLoad({ confirmed: 0, adjustments: 0, missed: 0 }, 120)).toThrow(RangeError);
  });
  it('keeps the fairness bound with fractional loads', () => {
    const rng = mulberry32(11);
    for (let t = 0; t < 2000; t++) {
      const { chores, members, E } = randomHousehold(rng);
      for (const m of members) m.load += Math.round(rng() * 2) / 2 - (m.load > 0 ? 0.5 : 0);
      const min = Math.min(...members.map((m) => m.load));
      for (const m of members) m.load = Math.min(m.load, min + E);
      expect(allocate('workload', chores, members, P0).gap).toBeLessThanOrEqual(E);
    }
  });
});
