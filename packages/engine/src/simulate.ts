// Research simulation: workload-aware allocation vs basic rotation (SDD 1.3, RC-12).
// Each synthetic household is run under both modes with the same random draws
// (common random numbers), so differences come from the allocation rule alone.

import { allocate, addDays } from './allocate.js';
import type { AllocationMode, Chore, Frequency, Member, Preference } from './types.js';

/** Small seeded PRNG so every run is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Typical shared-household chores with a default effort (1–5) and frequency. */
export const CATALOG: Array<[string, number, Frequency]> = [
  ['Wash dishes', 2, 'daily'], ['Take out trash', 1, 'twice_weekly'], ['Clean bathroom', 4, 'weekly'],
  ['Vacuum common areas', 3, 'weekly'], ['Mop kitchen floor', 3, 'weekly'], ['Wipe counters', 1, 'daily'],
  ['Grocery run', 3, 'weekly'], ['Clean fridge', 3, 'biweekly'], ['Recycling', 1, 'weekly'],
  ['Clean oven and stove', 4, 'biweekly'], ['Water plants', 1, 'twice_weekly'], ['Dust living room', 2, 'weekly'],
  ['Laundry towels', 2, 'weekly'], ['Deep clean shower', 5, 'biweekly'], ['Sweep entrance', 1, 'twice_weekly'],
  ['Clean windows', 4, 'biweekly'], ['Restock supplies', 2, 'weekly'], ['Yard or balcony tidy', 3, 'biweekly'],
];

export interface Scenario {
  name: string;
  label: string;
  households: number;
  weeks: number;
  sizeRange: [number, number];
  choreRange: [number, number];
  reliabilityRange: [number, number];
  /** Completion probability multiplier when the assignee dislikes the chore. */
  dislikePenalty: number;
  /** Weekly chance a member takes 1–2 single days off. */
  dayOffRate: number;
  /** Weekly chance a member starts a 1–3 week vacation. */
  vacationRate: number;
  seed: number;
}

export const BASE: Scenario = {
  name: 'baseline', label: 'Baseline', households: 2000, weeks: 12, sizeRange: [2, 8], choreRange: [8, 14],
  reliabilityRange: [0.6, 0.98], dislikePenalty: 0.85, dayOffRate: 0.1, vacationRate: 0.02, seed: 20261110,
};

export const SCENARIOS: Scenario[] = [
  BASE,
  { ...BASE, name: 'high_skip', label: 'Less reliable members', reliabilityRange: [0.4, 0.9], dislikePenalty: 0.7, seed: 20261111 },
  { ...BASE, name: 'no_absences', label: 'No absences', dayOffRate: 0, vacationRate: 0, seed: 20261112 },
  { ...BASE, name: 'frequent_absences', label: 'Frequent absences', dayOffRate: 0.3, vacationRate: 0.06, seed: 20261113 },
];

interface SimMember {
  id: string;
  reliability: number;
  preferences: Record<string, Preference>;
  /** week → unavailable day offsets (0–6); 7 entries = away all week. */
  away: Map<number, Set<number>>;
}

export interface Household {
  id: number;
  chores: Chore[];
  members: SimMember[];
  /** week → chore id → day offset → uniform draw for completion. Shared by both modes. */
  draws: Map<string, number>;
}

const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

export function makeHousehold(id: number, s: Scenario, rng: () => number): Household {
  const size = int(rng, ...s.sizeRange);
  const pool = [...CATALOG];
  const chores: Chore[] = [];
  for (let i = 0, n = int(rng, ...s.choreRange); i < n; i++) {
    const [name, effort, frequency] = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
    // Households rate effort a little differently from the default (effort voting, US-30).
    const e = Math.min(5, Math.max(1, effort + (rng() < 0.2 ? (rng() < 0.5 ? -1 : 1) : 0)));
    chores.push({ id: `c${i}`, name, effort: e, frequency, sortOrder: i });
  }
  const members: SimMember[] = [];
  for (let m = 0; m < size; m++) {
    const preferences: Record<string, Preference> = {};
    for (const c of chores) {
      const r = rng();
      preferences[c.id] = r < 0.25 ? 'prefer' : r < 0.75 ? 'neutral' : 'dislike';
    }
    const away = new Map<number, Set<number>>();
    for (let w = 0; w < s.weeks; w++) {
      if (rng() < s.vacationRate) {
        const len = int(rng, 1, 3);
        for (let k = w; k < Math.min(s.weeks, w + len); k++) away.set(k, new Set([0, 1, 2, 3, 4, 5, 6]));
      }
      if (rng() < s.dayOffRate) {
        const set = away.get(w) ?? new Set<number>();
        for (let k = 0, n = int(rng, 1, 2); k < n; k++) set.add(int(rng, 0, 6));
        away.set(w, set);
      }
    }
    members.push({ id: `m${m}`, reliability: s.reliabilityRange[0] + rng() * (s.reliabilityRange[1] - s.reliabilityRange[0]), preferences, away });
  }
  const draws = new Map<string, number>();
  for (let w = 0; w < s.weeks; w++) for (const c of chores) for (let d = 0; d < 7; d++) draws.set(`${w}|${c.id}|${d}`, rng());
  return { id, chores, members, draws };
}

/**
 * The allocation methods compared. The workload variants run the same engine and
 * differ only in how a missed chore counts toward a member's load (the
 * member_workload view): 0 = not at all (current DD-05), 0.5 = half, 1 = fully.
 */
export interface Variant { name: string; label: string; mode: AllocationMode; missedWeight: number }
export const VARIANTS: Variant[] = [
  { name: 'rotation', label: 'Basic rotation', mode: 'rotation', missedWeight: 0 },
  { name: 'workload', label: 'Workload-aware (missed = 0)', mode: 'workload', missedWeight: 0 },
  { name: 'workload_half', label: 'Workload-aware (missed = ½)', mode: 'workload', missedWeight: 0.5 },
  { name: 'workload_full', label: 'Workload-aware (missed = 1)', mode: 'workload', missedWeight: 1 },
];

export interface HouseholdResult {
  scenario: string;
  household: number;
  size: number;
  chores: number;
  mode: string;
  /** Gini of assigned effort per available day (0 = perfectly even). */
  giniAssigned: number;
  /** Gini of completed effort per available day. */
  giniCompleted: number;
  /** Largest weekly gap between members' assigned effort, in units of E. Mean over weeks. */
  meanWeeklyGapE: number;
  /** Share of weeks whose end-of-week assigned-load gap (US-09) was ≤ E. */
  boundHeldRate: number;
  completionRate: number;
  dislikedShare: number;
  preferredShare: number;
  /** Fairness proxy: share of members whose effort per available day is > 20% above the household mean. */
  overloadedShare: number;
  fallbackRate: number;
  unassigned: number;
}

const START = '2026-01-05'; // a Monday

export function gini(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2 || mean === 0) return 0;
  let sum = 0;
  for (const a of v) for (const b of v) sum += Math.abs(a - b);
  return sum / (2 * n * n * mean);
}

export function runHousehold(h: Household, variant: Variant, s: Scenario): HouseholdResult {
  const mode = variant.mode;
  const assigned = new Map(h.members.map((m) => [m.id, 0]));
  const completed = new Map(h.members.map((m) => [m.id, 0]));
  const availDays = new Map(h.members.map((m) => [m.id, 0]));
  /** The engine's load: confirmed effort plus rejoin adjustments, like the member_workload view. */
  const engineLoad = new Map(h.members.map((m) => [m.id, 0]));
  let instances = 0, done = 0, disliked = 0, preferred = 0, fallbacks = 0, unassigned = 0;
  let gapSum = 0, boundHeld = 0;
  const E = Math.max(...h.chores.map((c) => c.effort));

  for (let w = 0; w < s.weeks; w++) {
    const startsOn = addDays(START, 7 * w);
    const members: Member[] = h.members.map((m, i) => {
      const off = m.away.get(w) ?? new Set<number>();
      const wasAway = (m.away.get(w - 1)?.size ?? 0) === 7;
      availDays.set(m.id, availDays.get(m.id)! + (7 - off.size));
      return {
        id: m.id, rotationPosition: i, load: engineLoad.get(m.id)!,
        unavailableDates: [...off].map((d) => addDays(startsOn, d)),
        preferences: m.preferences, returningFromAbsence: wasAway && off.size < 7,
      };
    });
    const r = allocate(mode, h.chores, members, { startsOn, index: w });
    if (mode === 'workload') for (const a of r.adjustments) engineLoad.set(a.memberId, engineLoad.get(a.memberId)! + a.points);
    fallbacks += r.fallbacks;
    unassigned += (r as { unassigned?: unknown[] }).unassigned?.length ?? 0;

    const weekAssigned = new Map(h.members.map((m) => [m.id, 0]));
    for (const a of r.assignments) {
      instances++;
      const sm = h.members.find((m) => m.id === a.memberId)!;
      const pref = sm.preferences[a.choreId]!;
      if (pref === 'dislike') disliked++;
      if (pref === 'prefer') preferred++;
      assigned.set(a.memberId, assigned.get(a.memberId)! + a.effort);
      weekAssigned.set(a.memberId, weekAssigned.get(a.memberId)! + a.effort);
      const day = Math.round((Date.parse(a.dueOn) - Date.parse(startsOn)) / 86400000);
      const p = sm.reliability * (pref === 'dislike' ? s.dislikePenalty : 1);
      if (h.draws.get(`${w}|${a.choreId}|${day}`)! < p) {
        done++;
        completed.set(a.memberId, completed.get(a.memberId)! + a.effort);
        engineLoad.set(a.memberId, engineLoad.get(a.memberId)! + a.effort);
      } else if (variant.missedWeight > 0) {
        engineLoad.set(a.memberId, engineLoad.get(a.memberId)! + variant.missedWeight * a.effort);
      }
    }
    const present = members.filter((m) => m.unavailableDates.length < 7).map((m) => weekAssigned.get(m.id)!);
    if (present.length > 1) gapSum += (Math.max(...present) - Math.min(...present)) / E;
    if (r.boundHeld) boundHeld++;
  }

  const perDay = (src: Map<string, number>) =>
    h.members.filter((m) => availDays.get(m.id)! > 0).map((m) => src.get(m.id)! / availDays.get(m.id)!);
  const rates = perDay(assigned);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  return {
    scenario: s.name, household: h.id, size: h.members.length, chores: h.chores.length, mode: variant.name,
    giniAssigned: gini(rates), giniCompleted: gini(perDay(completed)),
    meanWeeklyGapE: gapSum / s.weeks, boundHeldRate: boundHeld / s.weeks,
    completionRate: instances ? done / instances : 0,
    dislikedShare: instances ? disliked / instances : 0,
    preferredShare: instances ? preferred / instances : 0,
    overloadedShare: rates.filter((x) => x > mean * 1.2).length / rates.length,
    fallbackRate: instances ? fallbacks / instances : 0,
    unassigned,
  };
}

export function runScenario(s: Scenario): HouseholdResult[] {
  const rng = mulberry32(s.seed);
  const out: HouseholdResult[] = [];
  for (let i = 0; i < s.households; i++) {
    const h = makeHousehold(i, s, rng);
    for (const v of VARIANTS) out.push(runHousehold(h, v, s));
  }
  return out;
}
