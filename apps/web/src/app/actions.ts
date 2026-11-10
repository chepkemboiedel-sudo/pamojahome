'use server';
// Every write goes through a database function (RLS + SECURITY DEFINER), so these
// actions only validate input shape and pass the user's own session along.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { allocateHousehold } from '@/lib/allocation-runner';
import { getContext } from '@/lib/household';
import { publicEnv } from '@/lib/env';
import { back, friendly, safePath, text, uuid } from '@/lib/form';

// ---- Account -------------------------------------------------------------------
export async function signIn(form: FormData) {
  const email = text(form, 'email'), password = String(form.get('password') ?? '');
  if (!email || !password) back('/sign-in', 'error', 'Enter your email and password.');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) back('/sign-in', 'error', 'That email and password don’t match an account.');
  redirect('/');
}

export async function signUp(form: FormData) {
  const name = text(form, 'name'), email = text(form, 'email'), password = String(form.get('password') ?? '');
  const path = '/sign-in?mode=signup';
  if (!name || name.length > 60) back(path, 'error', 'Enter your name (up to 60 characters).');
  if (password.length < 8) back(path, 'error', 'Use a password of at least 8 characters.');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: name }, emailRedirectTo: `${publicEnv.siteUrl()}/auth/callback?next=/setup` },
  });
  if (error) back(path, 'error', error.message);
  if (!data.session) back('/sign-in', 'ok', 'Check your email to confirm your account, then sign in.');
  redirect('/setup');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

// ---- Household setup (US-02, US-03) -------------------------------------------------
export async function createHousehold(form: FormData) {
  const name = text(form, 'household'), me = text(form, 'name'), tz = text(form, 'timezone') || 'UTC';
  if (!name || name.length > 80) back('/setup', 'error', 'Give your household a name (up to 80 characters).');
  if (!me) back('/setup', 'error', 'Enter the name your housemates know you by.');
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('create_household', { p_name: name, p_display_name: me, p_timezone: tz });
  if (error || !id) back('/setup', 'error', friendly(error));
  redirect('/setup/invite');
}

export async function joinHousehold(form: FormData) {
  const code = text(form, 'code').toUpperCase(), me = text(form, 'name');
  const path = '/setup?mode=join';
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) back(path, 'error', 'Invite codes look like ABCD-1234.');
  if (!me) back(path, 'error', 'Enter the name your housemates know you by.');
  const supabase = await createClient();
  const { error } = await supabase.rpc('join_household', { p_code: code, p_display_name: me });
  if (error) back(path, 'error', friendly(error));
  redirect('/');
}

export async function newInvite(): Promise<string> {
  const ctx = await getContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_invite', { p_household: ctx.household.id });
  if (error || !data) throw new Error(friendly(error));
  return data as string;
}

// ---- Chores (US-05, US-07) ----------------------------------------------------------
export async function saveChore(form: FormData) {
  const ctx = await getContext();
  const name = text(form, 'name'), frequency = text(form, 'frequency'), effort = Number(form.get('effort'));
  const path = '/me/chores';
  if (!name) back(path, 'error', 'Give the chore a name.');
  if (!['daily', 'twice_weekly', 'weekly', 'biweekly'].includes(frequency)) back(path, 'error', 'Pick how often it repeats.');
  if (!(effort >= 1 && effort <= 5)) back(path, 'error', 'Effort is from 1 to 5.');
  const supabase = await createClient();
  const { error } = await supabase.rpc('upsert_chore', {
    p_household: ctx.household.id, p_chore: uuid(text(form, 'id')), p_name: name, p_frequency: frequency, p_effort: effort,
  });
  if (error) back(path, 'error', friendly(error));
  revalidatePath(path);
  back(path, 'ok', `Saved “${name}”.`);
}

export async function setPreference(form: FormData) {
  const chore = uuid(text(form, 'chore')), pref = text(form, 'preference');
  if (!chore || !['prefer', 'neutral', 'dislike'].includes(pref)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_chore_preference', { p_chore: chore, p_preference: pref });
  if (error) back('/me/chores', 'error', friendly(error));
  revalidatePath('/me/chores');
}

/** Organizer starts the first week now instead of waiting for Monday's job. */
export async function shareOutThisWeek() {
  const ctx = await getContext();
  if (ctx.role !== 'organizer') back('/', 'error', 'Only the organizer can share out chores.');
  // Allocation writes are service-only (migration 5); the organizer check above gates it.
  const result = await allocateHousehold(createServiceClient(), ctx.household.id);
  revalidatePath('/', 'layout');
  if (result.status === 'no_chores') back('/me/chores', 'error', 'Add at least one chore first.');
  if (result.status === 'already_allocated') back('/chores', 'ok', 'This week’s chores are already shared out.');
  back('/chores', 'ok', `Shared out ${result.tasks} chores for this week.`);
}

// ---- Tasks (US-11 to US-14) -----------------------------------------------------------
async function taskCall(fn: string, args: Record<string, unknown>, path: string, ok: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  revalidatePath('/', 'layout');
  if (error) back(path, 'error', friendly(error));
  back(path, 'ok', ok);
}

export async function markDone(form: FormData) {
  const id = uuid(text(form, 'task'));
  const minutes = Number(form.get('minutes')) || null;
  if (!id) return;
  await taskCall('mark_task_done', { p_task: id, p_minutes: minutes && minutes >= 1 && minutes <= 1440 ? minutes : null },
    `/chores/${id}`, 'Marked complete. A housemate will confirm it.');
}

export async function undoDone(form: FormData) {
  const id = uuid(text(form, 'task'));
  if (!id) return;
  await taskCall('undo_task_done', { p_task: id }, `/chores/${id}`, 'Back to To do.');
}

export async function confirmTask(form: FormData) {
  const id = uuid(text(form, 'task'));
  if (!id) return;
  await taskCall('confirm_task', { p_task: id }, safePath(text(form, 'from'), '/confirm'), 'Confirmed. Thanks for checking.');
}

export async function disputeTask(form: FormData) {
  const id = uuid(text(form, 'task')), note = text(form, 'note').slice(0, 500);
  if (!id) return;
  if (!note) back('/confirm', 'error', 'Add a short, kind note about what still needs doing.');
  await taskCall('dispute_task', { p_task: id, p_note: note }, '/confirm', 'Sent back with your note.');
}
