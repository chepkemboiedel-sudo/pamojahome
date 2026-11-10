import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { explainAssignment, type Assignment } from '@pamojahome/allocation-engine';
import { getContext } from '@/lib/household';
import { taskById } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { shortDate } from '@/lib/dates';
import { markDone, undoDone } from '@/app/actions';
import { Card, Icon, Notice, Pill, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Chore' };

const FREQ: Record<string, string> = { daily: 'Daily', twice_weekly: 'Twice a week', weekly: 'Weekly', biweekly: 'Every two weeks' };
type Pref = 'prefer' | 'neutral' | 'dislike';

export default async function ChoreDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, getContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const task = await taskById(id);
  if (!task) notFound();
  const mine = task.member_id === ctx.memberId;

  const supabase = await createClient();
  const [{ data: pref }, { data: assignee }] = await Promise.all([
    task.chore_id
      ? supabase.from('chore_preferences').select('preference').eq('chore_id', task.chore_id).eq('member_id', task.member_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('household_members').select('display_name').eq('id', task.member_id).maybeSingle(),
  ]);
  const preference = (pref?.preference ?? 'neutral') as Pref;
  const why = task.allocation_reason
    ? explainAssignment({ reason: task.allocation_reason, preference } as Assignment)
    : task.kind === 'one_off' ? 'You logged this one-off task yourself.' : null;

  const statusPill = {
    assigned: <Pill tone="warn">To do</Pill>,
    pending_confirmation: <Pill tone="brand">Waiting for a housemate</Pill>,
    confirmed: <Pill tone="good"><Icon.Check /> Confirmed</Pill>,
    escalated: <Pill tone="warn">With the organizer</Pill>,
    missed: <Pill tone="neutral">Missed</Pill>,
    cancelled: <Pill tone="neutral">Cancelled</Pill>,
  }[task.status];

  return (
    <Screen>
      <Link href="/chores" className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-brand-900">
        <Icon.Back /> My chores
      </Link>
      <div className="flex flex-col items-start gap-2">
        <h1 className="m-0 text-[28px] font-bold leading-tight">{task.title}</h1>
        {statusPill}
      </div>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <Card>
        <dl className="m-0 grid grid-cols-[96px_1fr] gap-y-2.5 text-[15px]">
          <dt className="text-muted">Due</dt><dd className="m-0 font-semibold">{task.due_on ? shortDate(task.due_on) : '—'}</dd>
          <dt className="text-muted">Effort</dt><dd className="m-0 font-semibold">{task.effort} of 5</dd>
          {task.chores?.frequency && (<><dt className="text-muted">Repeats</dt><dd className="m-0 font-semibold">{FREQ[task.chores.frequency]}</dd></>)}
          {!mine && (<><dt className="text-muted">Assigned to</dt><dd className="m-0 font-semibold">{assignee?.display_name}</dd></>)}
        </dl>
      </Card>

      {why && mine && (
        <Card labelledBy="why-h" className="border-brand-100 bg-brand-100/50">
          <SectionTitle id="why-h">Why this is yours</SectionTitle>
          <p className="m-0 text-[15px] leading-normal">{why}</p>
          {task.allocation_reason !== 'rotation' && (
            <Link href="/me/chores" className="text-[13px] font-semibold text-brand-900">Change your chore ratings</Link>
          )}
        </Card>
      )}

      {mine && task.status === 'assigned' && (
        <form action={markDone} className="flex flex-col gap-3">
          <input type="hidden" name="task" value={task.id} />
          <label htmlFor="minutes" className="text-sm font-semibold">
            How long did it take? <span className="font-normal text-muted">(optional, helps the research)</span>
          </label>
          <input id="minutes" name="minutes" type="number" inputMode="numeric" min={1} max={1440} placeholder="Minutes"
            className="min-h-12 rounded-xl border border-control bg-white px-3.5 text-base" />
          <SubmitButton pendingText="Saving…">Mark complete</SubmitButton>
        </form>
      )}
      {mine && task.status === 'pending_confirmation' && task.kind === 'scheduled' && (
        <form action={undoDone} className="flex flex-col gap-3">
          <p className="m-0 text-[15px] leading-normal text-muted">
            A housemate will confirm it. If nobody disputes it within 48 hours, it confirms automatically and
            {' '}{task.effort} {task.effort === 1 ? 'point is' : 'points are'} added to your workload.
          </p>
          <input type="hidden" name="task" value={task.id} />
          <SubmitButton variant="secondary" pendingText="Undoing…">Undo</SubmitButton>
        </form>
      )}
    </Screen>
  );
}
