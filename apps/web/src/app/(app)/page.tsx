import Link from 'next/link';
import { getContext, colorFor } from '@/lib/household';
import { householdSnapshot, toConfirm } from '@/lib/queries';
import { dueLabel, money } from '@/lib/dates';
import { shareOutThisWeek } from '@/app/actions';
import { Card, Eyebrow, Icon, ListLink, Notice, Pill, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const [snap, confirmable] = await Promise.all([householdSnapshot(ctx), toConfirm(ctx)]);
  const view = sp.view === 'week' ? 'week' : 'all';

  const weekPoints = new Map<string, number>();
  for (const t of snap.weekTasks) weekPoints.set(t.member_id, (weekPoints.get(t.member_id) ?? 0) + t.effort);
  const points = (id: string) => (view === 'week' ? weekPoints.get(id) ?? 0 : snap.workload.get(id) ?? 0);
  const rows = snap.members.map((m) => ({ ...m, points: points(m.id) }));
  const max = Math.max(1, ...rows.map((r) => r.points));
  const gap = rows.length ? Math.max(...rows.map((r) => r.points)) - Math.min(...rows.map((r) => r.points)) : 0;
  const balanced = snap.largestEffort === 0 || gap <= snap.largestEffort;

  const myNext = snap.weekTasks.filter((t) => t.member_id === ctx.memberId && t.status === 'assigned' && t.due_on && t.due_on >= ctx.today)[0];
  const myBalance = snap.balances.get(ctx.memberId) ?? 0;
  const seg = (active: boolean) =>
    `flex min-h-10 flex-1 items-center justify-center rounded-lg text-sm font-semibold ${active ? 'bg-white text-brand-900 shadow-sm' : 'text-muted'}`;

  return (
    <Screen>
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>{ctx.household.name} · {snap.members.length} {snap.members.length === 1 ? 'member' : 'members'}</Eyebrow>
          <h1 className="m-0 text-[28px] font-bold leading-tight">Hi, {ctx.displayName}</h1>
        </div>
      </header>

      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <Card labelledBy="fair-h">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle id="fair-h">Workload</SectionTitle>
          {balanced ? <Pill tone="brand"><Icon.Check /> Balanced</Pill> : <Pill tone="warn">Evening out</Pill>}
        </div>
        <nav aria-label="Time period" className="flex gap-1 rounded-[10px] bg-page p-1">
          <Link href="/?view=week" aria-current={view === 'week' ? 'true' : undefined} className={seg(view === 'week')}>This week</Link>
          <Link href="/" aria-current={view === 'all' ? 'true' : undefined} className={seg(view === 'all')}>All time</Link>
        </nav>
        <p className="m-0 text-sm leading-snug text-muted">
          {snap.largestEffort === 0
            ? 'Add chores to start tracking workload.'
            : gap === 0
              ? 'Everyone has done the same amount so far.'
            : balanced
              ? `Everyone is within ${fmtPoints(gap)} ${gap === 1 ? 'point' : 'points'} of each other, less than one large chore.`
              : `Workloads differ by ${fmtPoints(gap)} points. The next chores go to whoever has done least, so this evens out.`}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((m) => (
            <li key={m.id} className="grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-2.5">
              <span className="truncate text-sm font-semibold">{m.id === ctx.memberId ? 'You' : m.display_name}</span>
              <span className="block h-2.5 overflow-hidden rounded-[5px] bg-track" role="presentation">
                <span className="block h-full rounded-[5px]" style={{ width: `${(m.points / max) * 100}%`, background: colorFor(m.rotation_position) }} />
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">{fmtPoints(m.points)}</span>
            </li>
          ))}
        </ul>
        <span className="text-xs text-muted">
          {view === 'week' ? 'Effort points assigned this week' : 'Confirmed effort, plus half of any missed chores'}
        </span>
      </Card>

      <section aria-labelledby="rem-h" className="flex flex-col gap-2.5">
        <SectionTitle id="rem-h">Needs your attention</SectionTitle>
        {!snap.weekAllocated && ctx.role === 'organizer' && snap.choreCount > 0 && (
          <form action={shareOutThisWeek} className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3.5">
            <span className="text-[15px] font-semibold">This week’s chores aren’t shared out yet</span>
            <span className="text-[13px] text-muted">They’re shared out automatically every Monday. You can start this week now.</span>
            <SubmitButton pendingText="Sharing out…">Share out this week</SubmitButton>
          </form>
        )}
        {snap.choreCount === 0 && (
          <ListLink href="/me/chores" icon={<Icon.Plus />} title="Add your household’s chores" detail="Name each chore and how much effort it takes" />
        )}
        {myNext && (
          <ListLink href={`/chores/${myNext.id}`} icon={<Icon.Clock />} iconTone="sun" title={myNext.title}
            detail={`${dueLabel(myNext.due_on!, ctx.today)} · Effort ${myNext.effort}`} />
        )}
        {confirmable.length > 0 && (
          <ListLink href="/confirm" icon={<Icon.Inbox />}
            title={`${confirmable.length} ${confirmable.length === 1 ? 'chore' : 'chores'} to confirm`}
            detail={`${[...new Set(confirmable.map((t) => snap.members.find((m) => m.id === t.member_id)?.display_name).filter(Boolean))].join(' and ')} marked ${confirmable.length === 1 ? 'a chore' : 'chores'} done`} />
        )}
        {myBalance !== 0 && (
          <ListLink href="/money" icon={<Icon.Wallet />} iconTone="pink"
            title={myBalance < 0 ? `You owe ${money(-myBalance)}` : `You’re owed ${money(myBalance)}`}
            detail="See settle-up suggestions" />
        )}
        {!myNext && confirmable.length === 0 && myBalance === 0 && snap.choreCount > 0 && snap.weekAllocated && (
          <Notice>You’re all caught up.</Notice>
        )}
      </section>
    </Screen>
  );
}
