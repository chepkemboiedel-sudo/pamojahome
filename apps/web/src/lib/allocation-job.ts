// Weekly allocation job (DD-05, DD-16). Turns database rows into engine input,
// runs the shared engine, and turns the result into one apply_allocation call.
// buildAllocation is pure so it can be unit-tested without a database.

import { addDays, allocate, type AllocationMode, type Chore, type Member, type Preference } from '@pamojahome/allocation-engine';
import { mondayOf, todayIn, weeksBetween } from '@/lib/dates';

export interface HouseholdRow { id: string; timezone: string; allocation_mode: AllocationMode; missed_weight_pct: number }
export interface MemberRow { id: string; rotation_position: number; status: 'active' | 'moving_out' | 'archived'; move_out_on: string | null }
export interface ChoreRow { id: string; name: string; effort: number; frequency: Chore['frequency']; sort_order: number; active: boolean }
export interface WorkloadRow { member_id: string; load_points: number | string }
export interface PreferenceRow { member_id: string; chore_id: string; preference: Preference }
export interface AbsenceRow { member_id: string; kind: 'day_off' | 'vacation'; starts_on: string; ends_on: string }

export interface AllocationInput {
  household: HouseholdRow;
  members: MemberRow[];
  chores: ChoreRow[];
  workload: WorkloadRow[];
  preferences: PreferenceRow[];
  absences: AbsenceRow[];
  /** starts_on of the household's first period, if any (for the biweekly and rotation week index). */
  firstPeriodStartsOn: string | null;
  now: Date;
}

export interface AllocationPlan {
  startsOn: string;
  mode: AllocationMode;
  missedWeightPct: number;
  tasks: Array<{ chore_id: string; member_id: string; due_on: string; effort: number; title: string; reason: string }>;
  adjustments: Array<{ member_id: string; points: number; reason: 'rejoin_baseline' }>;
  gap: number;
  boundHeld: boolean;
  /** Instances dropped because their day had already passed when the week was shared out. */
  skippedPastDays: number;
}

export function buildAllocation(input: AllocationInput): AllocationPlan {
  const { household } = input;
  const today = todayIn(household.timezone, input.now);
  const startsOn = mondayOf(today);
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(startsOn, d));

  const load = new Map(input.workload.map((w) => [w.member_id, Number(w.load_points)]));
  const prefs = new Map<string, Record<string, Preference>>();
  for (const p of input.preferences) {
    const m = prefs.get(p.member_id) ?? {};
    m[p.chore_id] = p.preference;
    prefs.set(p.member_id, m);
  }

  const members: Member[] = input.members
    .filter((m) => m.status !== 'archived')
    .map((m) => {
      const away = new Set<string>();
      for (const a of input.absences.filter((x) => x.member_id === m.id)) {
        for (const d of week) if (d >= a.starts_on && d <= a.ends_on) away.add(d);
      }
      // A member moving out takes no chores from their move-out date (US-29).
      if (m.move_out_on) for (const d of week) if (d >= m.move_out_on) away.add(d);
      // Back from a trip that ended last week: rejoin at the household minimum (US-34).
      const returning = input.absences.some((a) => a.member_id === m.id && a.kind === 'vacation' &&
        a.ends_on >= addDays(startsOn, -7) && a.ends_on < startsOn) && !away.has(startsOn);
      return {
        id: m.id, rotationPosition: m.rotation_position, load: load.get(m.id) ?? 0,
        unavailableDates: [...away].sort(), preferences: prefs.get(m.id) ?? {}, returningFromAbsence: returning,
      };
    });

  const chores: Chore[] = input.chores.filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name, effort: c.effort, frequency: c.frequency, sortOrder: c.sort_order }));

  const index = input.firstPeriodStartsOn ? Math.max(0, weeksBetween(input.firstPeriodStartsOn, startsOn)) : 0;
  const result = allocate(household.allocation_mode, chores, members, { startsOn, index });

  // A household that starts mid-week only gets chores from today on.
  const current = result.assignments.filter((a) => a.dueOn >= today);
  return {
    startsOn, mode: household.allocation_mode, missedWeightPct: household.missed_weight_pct,
    tasks: current.map((a) => ({ chore_id: a.choreId, member_id: a.memberId, due_on: a.dueOn, effort: a.effort, title: a.name, reason: a.reason })),
    adjustments: result.adjustments.map((a) => ({ member_id: a.memberId, points: a.points, reason: a.reason })),
    gap: result.gap, boundHeld: result.boundHeld,
    skippedPastDays: result.assignments.length - current.length,
  };
}
