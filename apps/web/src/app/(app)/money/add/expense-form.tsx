'use client';
import { useMemo, useState } from 'react';
import { centsToInput, equalShares, formatCents, parseCents } from '@/lib/money';
import { SubmitButton } from '@/components/submit-button';
import { addExpense } from '../actions';

interface Person { id: string; name: string }

export function ExpenseForm({ people, me, today, idempotencyKey }: {
  people: Person[]; me: string; today: string; idempotencyKey: string;
}) {
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(me);
  const [split, setSplit] = useState<'equal' | 'custom'>('equal');
  const [custom, setCustom] = useState<Record<string, string>>({});

  const total = parseCents(amount);
  const equal = useMemo(() => (total ? equalShares(total, people.map((p) => p.id), payer) : null), [total, people, payer]);
  const customCents = people.map((p) => (custom[p.id]?.trim() ? parseCents(custom[p.id]!) : 0));
  const customValid = customCents.every((c) => c !== null);
  const assigned = customCents.reduce<number>((s, c) => s + (c ?? 0), 0);
  const remaining = (total ?? 0) - assigned;
  const canSave = Boolean(total) && (split === 'equal' || (customValid && remaining === 0));

  const seg = (active: boolean) =>
    `min-h-10 flex-1 rounded-[9px] text-sm font-semibold ${active ? 'bg-white text-ink shadow-sm' : 'text-muted'}`;

  /** Starts custom amounts from the equal split, so people only adjust what differs. */
  function chooseCustom() {
    if (equal && Object.keys(custom).length === 0) {
      setCustom(Object.fromEntries(people.map((p) => [p.id, centsToInput(equal.get(p.id) ?? 0)])));
    }
    setSplit('custom');
  }

  return (
    <form action={addExpense} className="flex flex-col gap-4">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="split" value={split} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-semibold">Description</label>
        <input id="description" name="description" required maxLength={120} placeholder="Groceries, internet, pizza night…"
          className="min-h-12 rounded-xl border border-control bg-white px-3.5 text-base" />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="amount" className="text-sm font-semibold">Amount ($)</label>
          <input id="amount" name="amount" required inputMode="decimal" autoComplete="off" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== '' && !total} aria-describedby="amount-hint"
            className="min-h-12 rounded-xl border border-control bg-white px-3.5 text-base tabular-nums" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="spent_on" className="text-sm font-semibold">Date</label>
          <input id="spent_on" name="spent_on" type="date" required defaultValue={today} max={today}
            className="min-h-12 rounded-xl border border-control bg-white px-3 text-base" />
        </div>
      </div>
      {amount !== '' && !total && (
        <span id="amount-hint" role="alert" className="-mt-2 text-[13px] text-pink-800">Enter an amount like 24.99 (up to $100,000).</span>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="paid_by" className="text-sm font-semibold">Paid by</label>
        <select id="paid_by" name="paid_by" value={payer} onChange={(e) => setPayer(e.target.value)}
          className="min-h-12 rounded-xl border border-control bg-white px-3 text-base">
          {people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `${p.name} (you)` : p.name}</option>)}
        </select>
      </div>

      <fieldset className="m-0 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
        <legend className="sr-only">Split</legend>
        <span aria-hidden="true" className="text-sm font-semibold">Split</span>
        <div className="flex gap-1 rounded-[10px] bg-page p-1">
          <button type="button" aria-pressed={split === 'equal'} className={seg(split === 'equal')} onClick={() => setSplit('equal')}>Equally</button>
          <button type="button" aria-pressed={split === 'custom'} className={seg(split === 'custom')} onClick={chooseCustom}>Custom amounts</button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {people.map((p, i) => (
            <li key={p.id} className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-3">
              <label htmlFor={`share_${p.id}`} className="text-[15px]">{p.id === me ? 'You' : p.name}</label>
              {split === 'equal' ? (
                <span className="text-[15px] font-semibold tabular-nums">{equal ? formatCents(equal.get(p.id) ?? 0) : '—'}</span>
              ) : (
                <input id={`share_${p.id}`} name={`share_${p.id}`} inputMode="decimal" autoComplete="off" placeholder="0.00"
                  value={custom[p.id] ?? ''} onChange={(e) => setCustom({ ...custom, [p.id]: e.target.value })}
                  aria-invalid={customCents[i] === null}
                  className="min-h-11 w-28 rounded-xl border border-control bg-white px-3 text-right text-base tabular-nums" />
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-line pt-3 text-[15px]">
          <span className="font-semibold">{split === 'equal' ? 'Total' : 'Still to assign'}</span>
          <span aria-live="polite" className={`font-bold tabular-nums ${split === 'custom' && remaining !== 0 ? 'text-pink-800' : split === 'custom' ? 'text-brand-900' : ''}`}>
            {split === 'equal' ? (total ? formatCents(total) : '—')
              : !customValid ? 'Check the amounts'
              : remaining === 0 ? 'Adds up'
              : remaining > 0 ? `${formatCents(remaining)} left` : `${formatCents(remaining)} over`}
          </span>
        </div>
        {split === 'equal' && (
          <span className="text-[13px] text-muted">Split between everyone in the household. Any leftover cent goes to whoever paid.</span>
        )}
      </fieldset>

      <SubmitButton disabled={!canSave} pendingText="Saving…">Save expense</SubmitButton>
    </form>
  );
}
