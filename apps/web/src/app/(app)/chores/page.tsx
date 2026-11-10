import type { Metadata } from 'next';
import { getContext } from '@/lib/household';
import { householdSnapshot, toConfirm, type TaskRow } from '@/lib/queries';
import { dueLabel, weekRange } from '@/lib/dates';
import { Icon, ListLink, Notice, Pill, SectionTitle } from '@/components/ui';

export const metadata: Metadata = { title: 'My chores' };

const statusPill = (t: TaskRow) =>
  t.status === 'confirmed' ? <Pill tone="good"><Icon.Check /> Confirmed</Pill>
  : t.status === 'pending_confirmation' ? <Pill tone="brand">Waiting to confirm</Pill>
  : t.status === 'escalated' ? <Pill tone="warn">With organizer</Pill>
  : t.status === 'missed' ? <Pill tone="neutral">Missed</Pill>
  : null;

export default async function ChoresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [snap, confirmable] = await Promise.all([householdSnapshot(ctx), toConfirm(ctx)]);
  const mine = snap.weekTasks.filter((t) => t.member_id === ctx.memberId);
  const todo = mine.filter((t) => t.status === 'assigned');
  const done = mine.filter((t) => t.status !== 'assigned');
  const total = mine.reduce((s, t) => s + t.effort, 0);
  const reason = mine.find((t) => t.allocation_reason)?.allocation_reason;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-28 pt-5">
      <div className="-mx-5 -mt-5 flex flex-col gap-1.5 bg-brand px-5 pb-5 pt-6 text-white">
        <h1 className="m-0 text-[28px] font-bold">My chores</h1>
        <span className="text-[15px] text-brand-100">
          Week of {weekRange(ctx.weekStart)} · {total} effort {total === 1 ? 'point' : 'points'} assigned
        </span>
        {reason && (
          <span className="mt-1 text-sm">
            {reason === 'rotation' ? 'Assigned by basic rotation.' : 'Assigned by workload balance.'}
          </span>
        )}
      </div>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      {confirmable.length > 0 && (
        <ListLink href="/confirm" icon={<Icon.Inbox />} title="Waiting for your confirmation"
          detail={`${confirmable.length} ${confirmable.length === 1 ? 'chore' : 'chores'} from housemates`}
          trailing={<span className="text-sm font-semibold text-brand">Review</span>} />
      )}

      <section aria-labelledby="todo-h" className="flex flex-col gap-2.5">
        <SectionTitle id="todo-h">To do</SectionTitle>
        {todo.length === 0 && (
          <Notice>{snap.weekAllocated ? 'Nothing left to do this week.' : 'This week’s chores haven’t been shared out yet.'}</Notice>
        )}
        {todo.map((t) => (
          <ListLink key={t.id} href={`/chores/${t.id}`} icon={<Icon.Clock />} iconTone={t.due_on && t.due_on <= ctx.today ? 'sun' : 'brand'}
            title={t.title} detail={`${t.due_on ? dueLabel(t.due_on, ctx.today) : 'One-off'} · Effort ${t.effort}`} />
        ))}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="done-h" className="flex flex-col gap-2.5">
          <SectionTitle id="done-h">Done this week</SectionTitle>
          {done.map((t) => (
            <ListLink key={t.id} href={`/chores/${t.id}`} icon={<Icon.Check />} title={t.title}
              detail={`Effort ${t.effort}`} trailing={statusPill(t)} />
          ))}
        </section>
      )}
    </main>
  );
}
