'use server';
// Money writes (US-15 to US-19). The database checks membership, that shares add
// up to the total, who may record or reverse what, and ignores repeats of the
// same idempotency key, so a double-tap or a retried request never double-counts.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getContext } from '@/lib/household';
import { back, friendly, safePath, text, uuid } from '@/lib/form';
import { formatCents, parseCents } from '@/lib/money';

const ADD = '/money/add';

export async function addExpense(form: FormData) {
  const ctx = await getContext();
  const key = uuid(text(form, 'idempotency_key'));
  const description = text(form, 'description');
  const total = parseCents(text(form, 'amount'));
  const paidBy = uuid(text(form, 'paid_by'));
  const split = text(form, 'split') === 'custom' ? 'custom' : 'equal';
  const spentOn = text(form, 'spent_on');

  if (!key) back(ADD, 'error', 'This form expired. Please try again.');
  if (!description || description.length > 120) back(ADD, 'error', 'Describe the expense (up to 120 characters).');
  if (!total) back(ADD, 'error', 'Enter an amount like 24.99 (up to $100,000).');
  if (!paidBy) back(ADD, 'error', 'Choose who paid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || spentOn > ctx.today) back(ADD, 'error', 'Choose a date that isn’t in the future.');

  let shares: Array<{ member_id: string; share_cents: number }> | null = null;
  if (split === 'custom') {
    shares = [];
    for (const [name, value] of form.entries()) {
      if (!name.startsWith('share_')) continue;
      const member = uuid(name.slice('share_'.length));
      const raw = String(value).trim();
      const cents = raw === '' ? 0 : parseCents(raw);
      if (!member || cents === null) back(ADD, 'error', 'Each share must be an amount like 12.50, or left empty for $0.');
      shares.push({ member_id: member, share_cents: cents });
    }
    const sum = shares.reduce((s, x) => s + x.share_cents, 0);
    if (sum !== total) {
      back(ADD, 'error', `Shares add up to ${formatCents(sum)}, but the expense is ${formatCents(total)}.`);
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_expense', {
    p_household: ctx.household.id, p_description: description, p_amount_cents: total, p_paid_by: paidBy,
    p_split: split, p_shares: shares, p_idempotency_key: key, p_spent_on: spentOn,
  });
  if (error) back(ADD, 'error', friendly(error));
  revalidatePath('/', 'layout');
  back('/money', 'ok', `Saved “${description}”, ${formatCents(total)}. Balances are updated for everyone.`);
}

export async function recordPayment(form: FormData) {
  const ctx = await getContext();
  const from = safePath(text(form, 'from_path'), '/money/settle');
  const key = uuid(text(form, 'idempotency_key'));
  const [pairFrom = '', pairTo = ''] = text(form, 'direction_pair').split(':');
  const payer = uuid(text(form, 'from_member') || pairFrom);
  const payee = uuid(text(form, 'to_member') || pairTo);
  const amount = parseCents(text(form, 'amount'));
  if (!key) back(from, 'error', 'This form expired. Please try again.');
  if (!payer || !payee) back(from, 'error', 'Choose who paid and who was paid.');
  if (payer === payee) back(from, 'error', 'Someone can’t pay themselves.');
  if (!amount) back(from, 'error', 'Enter an amount like 25.00.');

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_payment', {
    p_household: ctx.household.id, p_from: payer, p_to: payee, p_amount_cents: amount,
    p_idempotency_key: key, p_paid_on: ctx.today,
  });
  if (error) back(from, 'error', friendly(error));
  revalidatePath('/', 'layout');
  back(from, 'ok', `Recorded a ${formatCents(amount)} payment.`);
}

export async function reverseEntry(form: FormData) {
  const kind = text(form, 'kind');
  const entry = uuid(text(form, 'entry'));
  const reason = text(form, 'reason').slice(0, 200) || null;
  if (!entry || !['expense', 'payment'].includes(kind)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('reverse_entry', { p_kind: kind, p_entry: entry, p_reason: reason });
  if (error) back('/money', 'error', friendly(error));
  revalidatePath('/', 'layout');
  back('/money', 'ok', 'Reversed. The original stays in history, and balances are updated.');
}
