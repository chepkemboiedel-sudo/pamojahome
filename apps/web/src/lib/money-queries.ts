import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Ctx } from '@/lib/household';

export interface HistoryItem {
  kind: 'expense' | 'payment';
  id: string;
  title: string;
  amountCents: number;
  /** Expense payer, or payment sender. */
  fromMember: string;
  /** Payment recipient. */
  toMember: string | null;
  split: 'equal' | 'custom' | 'itemized' | null;
  source: string | null;
  myShareCents: number | null;
  on: string;
  createdAt: string;
  createdBy: string;
  reversal: { by: string; reason: string | null; at: string } | null;
}

/** Newest-first history of expenses and payments, with reversals attached (US-19). */
export async function moneyHistory(ctx: Ctx, limit = 60): Promise<HistoryItem[]> {
  const supabase = await createClient();
  const hid = ctx.household.id;
  const [expenses, payments, reversals, myShares] = await Promise.all([
    supabase.from('expenses').select('id, description, amount_cents, paid_by, split_method, source, spent_on, created_by, created_at')
      .eq('household_id', hid).order('created_at', { ascending: false }).limit(limit),
    supabase.from('payments').select('id, from_member_id, to_member_id, amount_cents, paid_on, created_by, created_at')
      .eq('household_id', hid).order('created_at', { ascending: false }).limit(limit),
    supabase.from('reversals').select('expense_id, payment_id, reason, created_by, created_at').eq('household_id', hid),
    supabase.from('expense_shares').select('expense_id, share_cents').eq('household_id', hid).eq('member_id', ctx.memberId),
  ]);
  for (const r of [expenses, payments, reversals, myShares]) if (r.error) throw r.error;

  const rev = new Map<string, HistoryItem['reversal']>();
  for (const r of reversals.data ?? []) {
    rev.set((r.expense_id ?? r.payment_id) as string, { by: r.created_by, reason: r.reason, at: r.created_at });
  }
  const share = new Map((myShares.data ?? []).map((s) => [s.expense_id as string, Number(s.share_cents)]));

  const items: HistoryItem[] = [
    ...(expenses.data ?? []).map((e): HistoryItem => ({
      kind: 'expense', id: e.id, title: e.description, amountCents: Number(e.amount_cents), fromMember: e.paid_by,
      toMember: null, split: e.split_method, source: e.source, myShareCents: share.get(e.id) ?? 0,
      on: e.spent_on, createdAt: e.created_at, createdBy: e.created_by, reversal: rev.get(e.id) ?? null,
    })),
    ...(payments.data ?? []).map((p): HistoryItem => ({
      kind: 'payment', id: p.id, title: 'Payment', amountCents: Number(p.amount_cents), fromMember: p.from_member_id,
      toMember: p.to_member_id, split: null, source: null, myShareCents: null,
      on: p.paid_on, createdAt: p.created_at, createdBy: p.created_by, reversal: rev.get(p.id) ?? null,
    })),
  ];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Balance rows for everyone with a balance or still in the household. Sums to zero (US-16). */
export async function balances(ctx: Ctx) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('member_balances')
    .select('member_id, display_name, status, balance_cents').eq('household_id', ctx.household.id);
  if (error) throw error;
  return (data ?? []).map((b) => ({ ...b, balance_cents: Number(b.balance_cents) }))
    .filter((b) => b.status !== 'archived' || b.balance_cents !== 0);
}

export async function settleSuggestions(ctx: Ctx) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('settle_up_suggestions', { p_household: ctx.household.id });
  if (error) throw error;
  return ((data ?? []) as Array<{ from_member_id: string; to_member_id: string; amount_cents: number | string }>)
    .map((s) => ({ ...s, amount_cents: Number(s.amount_cents) }));
}
