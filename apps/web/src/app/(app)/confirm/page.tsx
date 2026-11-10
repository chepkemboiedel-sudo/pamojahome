import type { Metadata } from 'next';
import Link from 'next/link';
import { getContext, colorFor } from '@/lib/household';
import { householdSnapshot, toConfirm } from '@/lib/queries';
import { shortDate } from '@/lib/dates';
import { confirmTask, disputeTask } from '@/app/actions';
import { Avatar, Icon, Notice, Screen } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Confirm chores' };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [tasks, snap] = await Promise.all([toConfirm(ctx), householdSnapshot(ctx)]);
  const who = (id: string) => snap.members.find((m) => m.id === id);

  return (
    <Screen>
      <Link href="/chores" className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-brand-900">
        <Icon.Back /> My chores
      </Link>
      <h1 className="m-0 text-[28px] font-bold leading-tight">Confirm chores</h1>
      <p className="m-0 text-[15px] leading-normal text-muted">
        Housemates marked these done. Confirm what you can see is finished. Anything nobody disputes confirms on its own after 48 hours.
      </p>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {tasks.length === 0 && <Notice>Nothing waiting for you right now.</Notice>}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {tasks.map((t) => {
          const m = who(t.member_id);
          return (
            <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar name={m?.display_name ?? '?'} color={colorFor(m?.rotation_position ?? 0)} size={36} />
                <div className="flex flex-1 flex-col">
                  <span className="text-[15px] font-semibold">{t.title}</span>
                  <span className="text-[13px] text-muted">
                    {m?.display_name} · Effort {t.effort}{t.due_on ? ` · ${shortDate(t.due_on)}` : ''}{t.kind === 'one_off' ? ' · One-off' : ''}
                  </span>
                </div>
              </div>
              <form action={confirmTask}>
                <input type="hidden" name="task" value={t.id} />
                <input type="hidden" name="from" value="/confirm" />
                <SubmitButton className="w-full" pendingText="Confirming…">Confirm</SubmitButton>
              </form>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl text-[15px] font-semibold text-brand-900 hover:bg-brand-100">
                  Not done yet?
                </summary>
                <form action={disputeTask} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="task" value={t.id} />
                  <label htmlFor={`note-${t.id}`} className="text-sm font-semibold">What still needs doing?</label>
                  <textarea id={`note-${t.id}`} name="note" required maxLength={500} rows={2}
                    placeholder="e.g. The pans are still on the stove"
                    className="rounded-xl border border-control bg-white p-3 text-base" />
                  <span className="text-[13px] text-muted">The chore goes back to {m?.display_name}. A second dispute goes to the organizer.</span>
                  <SubmitButton variant="secondary" pendingText="Sending…">Send back</SubmitButton>
                </form>
              </details>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
