import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mondayOf, todayIn } from '@/lib/dates';

export interface Ctx {
  userId: string;
  memberId: string;
  displayName: string;
  role: 'organizer' | 'member';
  household: { id: string; name: string; timezone: string; allocation_mode: 'workload' | 'rotation'; missed_weight_pct: number };
  today: string;
  weekStart: string;
}

/**
 * The signed-in user's household context. One household per user in the MVP;
 * a user without one is sent to setup. Cached per request.
 */
export const getContext = cache(async (): Promise<Ctx> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const { data: member } = await supabase.from('household_members')
    .select('id, display_name, role, households (id, name, timezone, allocation_mode, missed_weight_pct)')
    .eq('user_id', user.id).neq('status', 'archived')
    .order('joined_at', { ascending: false }).limit(1).maybeSingle();
  if (!member?.households) redirect('/setup');
  const household = member.households as unknown as Ctx['household'];
  const today = todayIn(household.timezone);
  return {
    userId: user.id, memberId: member.id, displayName: member.display_name,
    role: member.role as Ctx['role'], household, today, weekStart: mondayOf(today),
  };
});

/** Member colours from the design system; ink initials on the light ones for contrast. */
export const MEMBER_COLORS = ['#7C3AED', '#EC4899', '#F97316', '#0EA5E9', '#14B8A6'] as const;
export const colorFor = (position: number) => MEMBER_COLORS[position % MEMBER_COLORS.length]!;
