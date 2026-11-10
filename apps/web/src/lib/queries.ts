import 'server-only';
import { addDays } from '@pamojahome/allocation-engine';
import { createClient } from '@/lib/supabase/server';
import type { Ctx } from '@/lib/household';

export type TaskStatus = 'assigned' | 'pending_confirmation' | 'confirmed' | 'escalated' | 'missed' | 'cancelled';
export interface TaskRow {
  id: string; title: string; member_id: string; due_on: string | null; effort: number; status: TaskStatus;
  kind: 'scheduled' | 'one_off'; completed_at: string | null; allocation_reason: string | null; chore_id: string | null;
}
export interface MemberRow { id: string; display_name: string; rotation_position: number; status: string; role: string }

const TASK_COLS = 'id, title, member_id, due_on, effort, status, kind, completed_at, allocation_reason, chore_id';

export async function householdSnapshot(ctx: Ctx) {
  const supabase = await createClient();
  const hid = ctx.household.id;
  const weekEnd = addDays(ctx.weekStart, 6);
  const [members, workload, week, chores, balances, period] = await Promise.all([
    supabase.from('household_members').select('id, display_name, rotation_position, status, role')
      .eq('household_id', hid).neq('status', 'archived').order('rotation_position'),
    supabase.from('member_workload').select('member_id, confirmed_points, load_points').eq('household_id', hid),
    supabase.from('tasks').select(TASK_COLS).eq('household_id', hid)
      .gte('due_on', ctx.weekStart).lte('due_on', weekEnd).neq('status', 'cancelled')
      .order('due_on').order('effort', { ascending: false }),
    supabase.from('chores').select('id, effort').eq('household_id', hid).eq('active', true),
    supabase.from('member_balances').select('member_id, balance_cents').eq('household_id', hid),
    supabase.from('scheduling_periods').select('id').eq('household_id', hid).eq('starts_on', ctx.weekStart).maybeSingle(),
  ]);
  const largestEffort = Math.max(0, ...(chores.data ?? []).map((c) => c.effort));
  return {
    members: (members.data ?? []) as MemberRow[],
    workload: new Map((workload.data ?? []).map((w) => [w.member_id as string, Number(w.load_points)])),
    weekTasks: (week.data ?? []) as TaskRow[],
    choreCount: chores.data?.length ?? 0,
    largestEffort,
    balances: new Map((balances.data ?? []).map((b) => [b.member_id as string, Number(b.balance_cents)])),
    weekAllocated: Boolean(period.data),
  };
}

/** Chores others marked done that the signed-in member can confirm (US-12). */
export async function toConfirm(ctx: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from('tasks').select(TASK_COLS)
    .eq('household_id', ctx.household.id).eq('status', 'pending_confirmation').neq('member_id', ctx.memberId)
    .order('completed_at', { ascending: true });
  return (data ?? []) as TaskRow[];
}

export async function taskById(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('tasks').select(`${TASK_COLS}, chores (frequency)`).eq('id', id).maybeSingle();
  return data as (TaskRow & { chores: { frequency: string } | null }) | null;
}
