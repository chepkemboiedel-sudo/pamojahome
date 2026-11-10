import type { Metadata } from 'next';
import { getContext, colorFor } from '@/lib/household';
import { householdSnapshot } from '@/lib/queries';
import { signOut } from '@/app/actions';
import { Avatar, Card, Icon, ListLink, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Me' };

export default async function MePage() {
  const ctx = await getContext();
  const snap = await householdSnapshot(ctx);
  const me = snap.members.find((m) => m.id === ctx.memberId);
  return (
    <Screen>
      <div className="flex items-center gap-3">
        <Avatar name={ctx.displayName} color={colorFor(me?.rotation_position ?? 0)} size={52} />
        <div className="flex flex-col">
          <h1 className="m-0 text-[24px] font-bold">{ctx.displayName}</h1>
          <span className="text-sm text-muted">{ctx.role === 'organizer' ? 'Organizer' : 'Member'} · {ctx.household.name}</span>
        </div>
      </div>
      <ListLink href="/me/chores" icon={<Icon.List />} title="Chores"
        detail={ctx.role === 'organizer' ? 'Add chores and rate the ones you prefer' : 'Rate the chores you prefer or dislike'} />
      {ctx.role === 'organizer' && (
        <ListLink href="/setup/invite" icon={<Icon.Plus />} title="Invite housemates" detail="Share an invite code" />
      )}
      <Card labelledBy="house-h">
        <SectionTitle id="house-h">Household</SectionTitle>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="text-muted">Chore sharing</dt>
          <dd className="m-0 font-semibold">{ctx.household.allocation_mode === 'workload' ? 'Workload balance' : 'Basic rotation'}</dd>
          <dt className="text-muted">Missed chores</dt>
          <dd className="m-0 font-semibold">Count {ctx.household.missed_weight_pct}% toward workload</dd>
          <dt className="text-muted">Time zone</dt>
          <dd className="m-0 font-semibold">{ctx.household.timezone}</dd>
        </dl>
      </Card>
      <form action={signOut}><SubmitButton variant="secondary" className="w-full" pendingText="Signing out…">Sign out</SubmitButton></form>
    </Screen>
  );
}
