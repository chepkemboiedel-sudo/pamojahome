import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAllocation, type AllocationInput } from '@/lib/allocation-job';
import { mondayOf, todayIn } from '@/lib/dates';
import { addDays } from '@pamojahome/allocation-engine';

export interface RunResult { householdId: string; status: 'allocated' | 'already_allocated' | 'no_chores'; tasks: number }

/** Shares out the current week for one household. Safe to repeat: a week is written once (migration 5). */
export async function allocateHousehold(db: SupabaseClient, householdId: string, now = new Date()): Promise<RunResult> {
  const { data: household, error } = await db.from('households')
    .select('id, timezone, allocation_mode, missed_weight_pct').eq('id', householdId).single();
  if (error || !household) throw new Error(`Household ${householdId} not found`);

  const startsOn = mondayOf(todayIn(household.timezone, now));
  const existing = await db.from('scheduling_periods').select('id')
    .eq('household_id', householdId).eq('starts_on', startsOn).maybeSingle();
  if (existing.data) return { householdId, status: 'already_allocated', tasks: 0 };

  const [members, chores, workload, preferences, absences, first] = await Promise.all([
    db.from('household_members').select('id, rotation_position, status, move_out_on').eq('household_id', householdId),
    db.from('chores').select('id, name, effort, frequency, sort_order, active').eq('household_id', householdId),
    db.from('member_workload').select('member_id, load_points').eq('household_id', householdId),
    db.from('chore_preferences').select('member_id, chore_id, preference').eq('household_id', householdId),
    db.from('absences').select('member_id, kind, starts_on, ends_on').eq('household_id', householdId)
      .gte('ends_on', addDays(startsOn, -7)).lte('starts_on', addDays(startsOn, 6)),
    db.from('scheduling_periods').select('starts_on').eq('household_id', householdId)
      .order('starts_on', { ascending: true }).limit(1).maybeSingle(),
  ]);
  for (const r of [members, chores, workload, preferences, absences]) if (r.error) throw r.error;

  const input: AllocationInput = {
    household, now,
    members: members.data ?? [], chores: chores.data ?? [], workload: workload.data ?? [],
    preferences: preferences.data ?? [], absences: absences.data ?? [],
    firstPeriodStartsOn: first.data?.starts_on ?? null,
  };
  if (!input.chores.some((c) => c.active)) return { householdId, status: 'no_chores', tasks: 0 };

  const plan = buildAllocation(input);
  const { error: writeError } = await db.rpc('apply_allocation', {
    p_household: householdId, p_starts_on: plan.startsOn, p_mode: plan.mode,
    p_missed_weight_pct: plan.missedWeightPct, p_tasks: plan.tasks, p_adjustments: plan.adjustments,
  });
  if (writeError) throw writeError;
  return { householdId, status: 'allocated', tasks: plan.tasks.length };
}
