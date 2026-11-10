// PamojaHome allocation engine.
// Pure and deterministic: no I/O, no clock, no randomness (RC-11). The live
// server and the research simulation import this same file (RC-12, DD-04).

import type {
  Adjustment, AllocationMode, AllocationResult, Assignment, Chore, ChoreInstance, Member,
  Period, Preference,
} from './types.js';

const PREF_RANK: Record<Preference, number> = { prefer: 0, neutral: 1, dislike: 2 };

/** Adds `days` to a YYYY-MM-DD date (UTC, no time zone drift). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const byMemberOrder = (a: Member, b: Member) =>
  a.rotationPosition - b.rotationPosition || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Turns chores into this period's dated instances.
 * daily = every day; twice_weekly = Monday and Thursday; weekly = one day,
 * spread across the week by sortOrder; biweekly = like weekly, even periods only.
 */
export function expandChores(chores: Chore[], period: Period): ChoreInstance[] {
  const out: ChoreInstance[] = [];
  for (const c of chores) {
    let offsets: number[];
    switch (c.frequency) {
      case 'daily': offsets = [0, 1, 2, 3, 4, 5, 6]; break;
      case 'twice_weekly': offsets = [0, 3]; break;
      case 'weekly': offsets = [c.sortOrder % 7]; break;
      case 'biweekly': offsets = period.index % 2 === 0 ? [c.sortOrder % 7] : []; break;
    }
    for (const o of offsets) {
      out.push({ choreId: c.id, name: c.name, effort: c.effort, dueOn: addDays(period.startsOn, o), sortOrder: c.sortOrder });
    }
  }
  return out;
}

function periodDates(period: Period): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((o) => addDays(period.startsOn, o));
}

/** Members free on at least one day of the period. The US-09 bound is measured over these. */
export function availableMembers(members: Member[], period: Period): Member[] {
  const dates = periodDates(period);
  return members.filter((m) => dates.some((d) => !m.unavailableDates.includes(d)));
}

/**
 * Members back from an excused absence rejoin at the lowest load among the
 * others, so they are not handed a pile of make-up chores (US-34, DD-05).
 */
export function rejoinAdjustments(members: Member[]): Adjustment[] {
  const continuing = members.filter((m) => !m.returningFromAbsence);
  if (continuing.length === 0) return [];
  const floor = Math.min(...continuing.map((m) => m.load));
  // Whole points, because adjustments are stored as integers; rounding up keeps the returner at or just above the floor.
  return members
    .filter((m) => m.returningFromAbsence && m.load < floor)
    .sort(byMemberOrder)
    .map((m) => ({ memberId: m.id, points: Math.ceil(floor - m.load), reason: 'rejoin_baseline' as const }));
}

function summarize(
  mode: AllocationMode, assignments: Assignment[], adjustments: Adjustment[],
  loads: Map<string, number>, pool: Member[], largestEffort: number, fallbacks: number,
  unassigned: ChoreInstance[],
): AllocationResult & { unassigned: ChoreInstance[] } {
  const projectedLoads = Object.fromEntries(loads);
  const poolLoads = pool.map((m) => loads.get(m.id) ?? 0);
  const gap = poolLoads.length ? Math.max(...poolLoads) - Math.min(...poolLoads) : 0;
  return { mode, assignments, adjustments, projectedLoads, largestEffort, gap,
           boundHeld: gap <= largestEffort, fallbacks, unassigned };
}

/**
 * Workload-aware allocation (DD-05).
 *
 * Chore instances are taken from highest to lowest effort. Let E be the largest
 * chore effort. An instance of effort e may go only to a member who is free that
 * day and whose load is at most (lowest load among available members) + (E − e).
 * Among those, the best preference wins, then the lowest load, then the fixed
 * member order. Nobody therefore ends more than E above the current minimum, and
 * the minimum never decreases, so a period that starts within E ends within E,
 * and a period that starts wider never gets wider.
 */
export function allocateWorkload(chores: Chore[], members: Member[], period: Period) {
  const ordered = [...members].sort(byMemberOrder);
  const pool = availableMembers(ordered, period);
  const adjustments = rejoinAdjustments(pool);
  const loads = new Map(ordered.map((m) => [m.id, m.load]));
  for (const a of adjustments) loads.set(a.memberId, (loads.get(a.memberId) ?? 0) + a.points);

  const largestEffort = chores.length ? Math.max(...chores.map((c) => c.effort)) : 0;
  const instances = expandChores(chores, period).sort((a, b) =>
    b.effort - a.effort || a.sortOrder - b.sortOrder || a.dueOn.localeCompare(b.dueOn) ||
    a.choreId.localeCompare(b.choreId));

  const assignments: Assignment[] = [];
  const unassigned: ChoreInstance[] = [];
  let fallbacks = 0;

  for (const inst of instances) {
    const free = pool.filter((m) => !m.unavailableDates.includes(inst.dueOn));
    if (free.length === 0) { unassigned.push(inst); continue; }
    const minLoad = Math.min(...pool.map((m) => loads.get(m.id)!));
    const threshold = minLoad + (largestEffort - inst.effort);
    let eligible = free.filter((m) => loads.get(m.id)! <= threshold);
    let reason: Assignment['reason'] | null = null;
    if (eligible.length === 0) {
      // The lowest-loaded members are away that day: give it to the least-loaded free member.
      fallbacks++;
      reason = 'fallback_unavailable';
      const lowest = Math.min(...free.map((m) => loads.get(m.id)!));
      eligible = free.filter((m) => loads.get(m.id)! === lowest);
    }
    const pref = (m: Member): Preference => m.preferences[inst.choreId] ?? 'neutral';
    const ranked = [...eligible].sort((a, b) =>
      PREF_RANK[pref(a)] - PREF_RANK[pref(b)] || loads.get(a.id)! - loads.get(b.id)! || byMemberOrder(a, b));
    const chosen = ranked[0]!;
    if (!reason) {
      const lowestEligible = Math.min(...eligible.map((m) => loads.get(m.id)!));
      const tiedLowest = eligible.filter((m) => loads.get(m.id)! === lowestEligible);
      if (loads.get(chosen.id)! > lowestEligible) reason = 'preference';
      else if (tiedLowest.length > 1 && tiedLowest.some((m) => PREF_RANK[pref(m)] > PREF_RANK[pref(chosen)])) reason = 'preference';
      else if (tiedLowest.length > 1) reason = 'tie_break';
      else reason = 'lowest_load';
    }
    loads.set(chosen.id, loads.get(chosen.id)! + inst.effort);
    assignments.push({ ...inst, memberId: chosen.id, reason, preference: pref(chosen) });
  }
  return summarize('workload', assignments, adjustments, loads, pool, largestEffort, fallbacks, unassigned);
}

/**
 * Basic rotation, the research baseline (US-06). Instance i of the period goes
 * to member (i + period index) in the fixed order, moving on to the next member
 * when that one is away that day. Effort, preferences and past load are ignored.
 */
export function allocateRotation(chores: Chore[], members: Member[], period: Period) {
  const ordered = [...members].sort(byMemberOrder);
  const pool = availableMembers(ordered, period);
  const loads = new Map(ordered.map((m) => [m.id, m.load]));
  const largestEffort = chores.length ? Math.max(...chores.map((c) => c.effort)) : 0;
  const instances = expandChores(chores, period).sort((a, b) =>
    a.dueOn.localeCompare(b.dueOn) || a.sortOrder - b.sortOrder || a.choreId.localeCompare(b.choreId));

  const assignments: Assignment[] = [];
  const unassigned: ChoreInstance[] = [];
  const n = ordered.length;
  instances.forEach((inst, i) => {
    for (let step = 0; step < n; step++) {
      const m = ordered[(i + period.index + step) % n]!;
      if (m.unavailableDates.includes(inst.dueOn)) continue;
      loads.set(m.id, loads.get(m.id)! + inst.effort);
      assignments.push({ ...inst, memberId: m.id, reason: 'rotation',
                         preference: m.preferences[inst.choreId] ?? 'neutral' });
      return;
    }
    unassigned.push(inst);
  });
  return summarize('rotation', assignments, [], loads, pool, largestEffort, 0, unassigned);
}

/** Entry point used by the server (`/api/cron/allocate`) and the simulation. */
export function allocate(mode: AllocationMode, chores: Chore[], members: Member[], period: Period) {
  const active = chores.filter((c) => c.effort >= 1 && c.effort <= 5);
  return mode === 'workload'
    ? allocateWorkload(active, members, period)
    : allocateRotation(active, members, period);
}
