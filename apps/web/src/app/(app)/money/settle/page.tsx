import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { getContext, colorFor } from '@/lib/household';
import { householdSnapshot } from '@/lib/queries';
import { balances, settleSuggestions } from '@/lib/money-queries';
import { formatCents } from '@/lib/money';
import { recordPayment } from '../actions';
import { Avatar, Card, Field, Icon, Notice, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Settle up' };

export default async function SettleUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [snap, bals, suggestions] = await Promise.all([householdSnapshot(ctx), balances(ctx), settleSuggestions(ctx)]);
  const position = new Map(snap.members.map((m) => [m.id, m.rotation_position]));
  const nameOf = new Map(bals.map((b) => [b.member_id, b.display_name]));
  for (const m of snap.members) nameOf.set(m.id, m.display_name);
  const who = (id: string) => (id === ctx.memberId ? 'You' : nameOf.get(id) ?? 'Former member');
  const total = bals.reduce((s, b) => s + b.balance_cents, 0);
  const mayRecord = (from: string, to: string) => ctx.role === 'organizer' || from === ctx.memberId || to === ctx.memberId;
  const others = snap.members.filter((m) => m.id !== ctx.memberId);

  return (
    <Screen>
      <Link href="/money" className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-brand-900">
        <Icon.Back /> Money
      </Link>
      <h1 className="m-0 text-[28px] font-bold">Settle up</h1>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <Card labelledBy="bal-h">
        <SectionTitle id="bal-h">Balances</SectionTitle>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {bals.map((b) => {
            const me = b.member_id === ctx.memberId;
            const c = b.balance_cents;
            return (
              <li key={b.member_id} className="flex items-center gap-3">
                <Avatar name={b.display_name} color={colorFor(position.get(b.member_id) ?? 0)} />
                <span className="flex-1 text-[15px] font-semibold">{who(b.member_id)}</span>
                <span className={`text-[15px] font-bold tabular-nums ${c === 0 ? 'text-muted' : c < 0 ? 'text-pink-800' : 'text-brand-900'}`}>
                  {c === 0 ? 'Settled up' : c < 0 ? `${me ? 'owe' : 'owes'} ${formatCents(c)}` : `${me ? 'are' : 'is'} owed ${formatCents(c)}`}
                </span>
              </li>
            );
          })}
        </ul>
        <span className="text-xs text-muted">All balances add up to {formatCents(total)}.</span>
      </Card>

      <section aria-labelledby="sug-h" className="flex flex-col gap-2.5">
        <SectionTitle id="sug-h">Suggested payments{suggestions.length ? ` · ${suggestions.length}` : ''}</SectionTitle>
        {suggestions.length === 0 && <Notice tone="success">Everyone is settled up.</Notice>}
        {suggestions.length > 0 && (
          <p className="m-0 text-sm text-muted">The fewest payments that bring everyone to zero.</p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {suggestions.map((s) => (
            <li key={`${s.from_member_id}-${s.to_member_id}`} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-3.5">
              <div className="flex items-center gap-2 text-[15px]">
                <strong>{who(s.from_member_id)}</strong>
                <span aria-hidden="true" className="text-muted">→</span>
                <span className="sr-only">{s.from_member_id === ctx.memberId ? 'pay' : 'pays'}</span>
                <strong className="flex-1">{who(s.to_member_id)}</strong>
                <span className="font-bold tabular-nums">{formatCents(s.amount_cents)}</span>
              </div>
              {mayRecord(s.from_member_id, s.to_member_id) && (
                <form action={recordPayment}>
                  <input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <input type="hidden" name="from_member" value={s.from_member_id} />
                  <input type="hidden" name="to_member" value={s.to_member_id} />
                  <input type="hidden" name="amount" value={(s.amount_cents / 100).toFixed(2)} />
                  <input type="hidden" name="from_path" value="/money/settle" />
                  <SubmitButton variant="secondary" className="w-full" pendingText="Recording…">Record payment</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {others.length > 0 && (
        <details className="rounded-[14px] border border-line bg-white p-3.5">
          <summary className="flex min-h-10 cursor-pointer list-none items-center text-[15px] font-semibold text-brand-900">
            Record a different payment
          </summary>
          <form action={recordPayment} className="mt-3 flex flex-col gap-4">
            <input type="hidden" name="idempotency_key" value={randomUUID()} />
            <input type="hidden" name="from_path" value="/money/settle" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="direction" className="text-sm font-semibold">Who paid whom</label>
              <select id="direction" name="direction_pair" className="min-h-12 rounded-xl border border-control bg-white px-3 text-base"
                defaultValue={`${ctx.memberId}:${others[0]!.id}`}>
                {others.flatMap((o) => [
                  <option key={`out-${o.id}`} value={`${ctx.memberId}:${o.id}`}>You paid {o.display_name}</option>,
                  <option key={`in-${o.id}`} value={`${o.id}:${ctx.memberId}`}>{o.display_name} paid you</option>,
                ])}
              </select>
            </div>
            <Field id="amount" label="Amount ($)" inputMode="decimal" placeholder="0.00" required autoComplete="off" />
            <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
          </form>
        </details>
      )}

      <p className="m-0 text-[13px] leading-snug text-muted">
        PamojaHome doesn’t move money. Pay with Venmo, Zelle, PayPal or cash, then record it here so balances stay accurate.
      </p>
    </Screen>
  );
}
