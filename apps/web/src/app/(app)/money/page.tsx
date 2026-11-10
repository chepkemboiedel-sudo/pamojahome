import type { Metadata } from 'next';
import Link from 'next/link';
import { getContext } from '@/lib/household';
import { createClient } from '@/lib/supabase/server';
import { balances, moneyHistory, type HistoryItem } from '@/lib/money-queries';
import { formatCents } from '@/lib/money';
import { shortDate } from '@/lib/dates';
import { reverseEntry } from './actions';
import { buttonStyles, Icon, Notice, Pill, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Money' };

const SPLIT = { equal: 'Split equally', custom: 'Custom split', itemized: 'Split by item' } as const;

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const supabase = await createClient();
  const [history, bals, { data: people }] = await Promise.all([
    moneyHistory(ctx), balances(ctx),
    supabase.from('household_members').select('id, display_name').eq('household_id', ctx.household.id),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const who = (id: string | null) => (id === ctx.memberId ? 'you' : nameOf.get(id ?? '') ?? 'a former member');
  const Who = (id: string | null) => who(id).replace(/^./, (c) => c.toUpperCase());
  const mine = bals.find((b) => b.member_id === ctx.memberId)?.balance_cents ?? 0;
  const canReverse = (i: HistoryItem) =>
    !i.reversal && (ctx.role === 'organizer' || i.createdBy === ctx.memberId || i.fromMember === ctx.memberId);

  return (
    <Screen>
      <h1 className="m-0 text-[28px] font-bold">Money</h1>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <section aria-label="Your balance"
        className={`flex flex-col gap-1 rounded-2xl p-5 ${mine < 0 ? 'bg-accent text-white' : mine > 0 ? 'bg-brand text-white' : 'border border-line bg-white'}`}>
        <span className="text-sm font-semibold opacity-90">Your balance</span>
        <span className="font-display text-[34px] font-bold tabular-nums">{formatCents(mine)}</span>
        <span className="text-[15px]">{mine < 0 ? 'You owe the household' : mine > 0 ? 'The household owes you' : 'You’re all settled up'}</span>
        <Link href="/money/settle"
          className={`mt-3 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-[15px] font-semibold ${mine === 0 ? 'bg-brand-100 text-brand-900' : 'bg-white text-ink'}`}>
          {mine === 0 ? 'See everyone’s balances' : 'Settle up'}
        </Link>
      </section>

      <Link href="/money/add" className={buttonStyles.primary}><Icon.Plus /> Add expense</Link>

      <section aria-labelledby="hist-h" className="flex flex-col gap-2.5">
        <SectionTitle id="hist-h">History</SectionTitle>
        {history.length === 0 && <Notice>No expenses yet. Add the first shared cost, like groceries or a bill.</Notice>}
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {history.map((i) => {
            const reversed = Boolean(i.reversal);
            const detail = i.kind === 'expense'
              ? `Paid by ${who(i.fromMember)} · ${SPLIT[i.split ?? 'equal']}${i.source === 'recurring' ? ' · Recurring' : ''} · ${shortDate(i.on)}`
              : `${Who(i.fromMember)} paid ${who(i.toMember)} · ${shortDate(i.on)}`;
            return (
              <li key={`${i.kind}-${i.id}`} className={`flex flex-col gap-2 rounded-[14px] border border-line p-3.5 ${reversed ? 'bg-page' : 'bg-white'}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex size-9 flex-none items-center justify-center rounded-[10px] ${i.kind === 'payment' ? 'bg-good-100 text-good' : 'bg-brand-100 text-brand-900'}`}>
                    {i.kind === 'payment' ? <Icon.Check /> : <Icon.Wallet />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {i.kind === 'payment' ? `Payment to ${who(i.toMember)}` : i.title}
                      {reversed && <Pill tone="neutral">Reversed</Pill>}
                    </span>
                    <span className="text-[13px] text-muted">{detail}</span>
                    {i.kind === 'expense' && !reversed && (
                      <span className="text-[13px] text-muted">Your share {formatCents(i.myShareCents ?? 0)}</span>
                    )}
                    {i.reversal && (
                      <span className="text-[13px] text-muted">
                        Reversed by {who(i.reversal.by)}{i.reversal.reason ? ` · “${i.reversal.reason}”` : ''}
                      </span>
                    )}
                  </div>
                  <span className={`text-[15px] tabular-nums ${reversed ? 'font-semibold text-muted line-through' : 'font-bold'}`}>
                    {formatCents(i.amountCents)}
                  </span>
                </div>
                {canReverse(i) && (
                  <details className="group">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center text-sm font-semibold text-brand-900">
                      Reverse this entry
                    </summary>
                    <form action={reverseEntry} className="mt-2 flex flex-col gap-2 rounded-xl bg-page p-3">
                      <p className="m-0 text-sm leading-snug">
                        Reverse this {formatCents(i.amountCents)} {i.kind}? Entries are never deleted. The original stays in history, marked reversed, and balances update.
                      </p>
                      <input type="hidden" name="kind" value={i.kind} />
                      <input type="hidden" name="entry" value={i.id} />
                      <label htmlFor={`reason-${i.id}`} className="text-sm font-semibold">Reason <span className="font-normal text-muted">(optional)</span></label>
                      <input id={`reason-${i.id}`} name="reason" maxLength={200} placeholder="e.g. Entered twice"
                        className="min-h-11 rounded-xl border border-control bg-white px-3 text-base" />
                      <SubmitButton variant="secondary" pendingText="Reversing…">Reverse</SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Screen>
  );
}
