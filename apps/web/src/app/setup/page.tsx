import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createHousehold, joinHousehold, signOut } from '@/app/actions';
import { Field, Notice, Screen } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { TimezoneInput } from '@/components/timezone-input';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Set up your household' };

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const { data: existing } = await supabase.from('household_members').select('id')
    .eq('user_id', user.id).neq('status', 'archived').limit(1).maybeSingle();
  if (existing) redirect('/');
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const myName = profile?.display_name ?? '';
  const isJoin = sp.mode === 'join';
  const option = (active: boolean) =>
    `flex flex-col gap-1 rounded-[14px] border-2 p-4 no-underline ${active ? 'border-brand bg-brand-100/60' : 'border-line bg-white'}`;

  return (
    <Screen nav={false}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold tracking-[0.06em] text-brand">STEP 1 OF 2</span>
        <form action={signOut}><button className="min-h-11 px-2 text-sm font-semibold text-muted">Sign out</button></form>
      </div>
      <h1 className="m-0 text-[28px] font-bold leading-tight">Set up your household</h1>
      <p className="m-0 text-[15px] leading-normal text-muted">Start a new household, or join one a housemate already created.</p>

      <nav aria-label="How do you want to start?" className="flex flex-col gap-2.5">
        <Link href="/setup" aria-current={!isJoin ? 'true' : undefined} className={option(!isJoin)}>
          <span className="text-base font-semibold text-ink">Create a household</span>
          <span className="text-sm text-muted">You’ll be the organizer and can invite housemates.</span>
        </Link>
        <Link href="/setup?mode=join" aria-current={isJoin ? 'true' : undefined} className={option(isJoin)}>
          <span className="text-base font-semibold text-ink">Join with an invite code</span>
          <span className="text-sm text-muted">Use the code a housemate sent you.</span>
        </Link>
      </nav>

      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      {isJoin ? (
        <form action={joinHousehold} className="flex flex-col gap-4">
          <Field id="code" label="Invite code" placeholder="e.g. MAPL-7K2Q" autoCapitalize="characters" autoComplete="off" required
            hint="Invite codes expire after 7 days." />
          <Field id="name" label="Your name in this household" defaultValue={myName} required maxLength={60} />
          <SubmitButton pendingText="Joining…">Join household</SubmitButton>
        </form>
      ) : (
        <form action={createHousehold} className="flex flex-col gap-4">
          <Field id="household" label="Household name" placeholder="Maple Street House" required maxLength={80} />
          <Field id="name" label="Your name in this household" defaultValue={myName} required maxLength={60} />
          <TimezoneInput />
          <SubmitButton pendingText="Creating…">Create household</SubmitButton>
        </form>
      )}
    </Screen>
  );
}
