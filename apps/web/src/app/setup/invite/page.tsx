import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getContext } from '@/lib/household';
import { newInvite } from '@/app/actions';
import { CopyButton } from '@/components/copy-button';
import { buttonStyles, Screen } from '@/components/ui';

export const metadata: Metadata = { title: 'Invite your housemates' };

/** Step 2 of setup, and the organizer's invite screen afterwards (US-03). */
export default async function InvitePage() {
  const ctx = await getContext();
  const supabase = await createClient();
  let code: string | null = null;
  if (ctx.role === 'organizer') {
    const { data } = await supabase.from('invites').select('code')
      .eq('household_id', ctx.household.id).is('revoked_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    code = data?.code ?? (await newInvite());
  }
  return (
    <Screen nav={false}>
      <span className="text-[13px] font-bold tracking-[0.06em] text-brand">STEP 2 OF 2</span>
      <h1 className="m-0 text-[28px] font-bold leading-tight">Invite your housemates</h1>
      <p className="m-0 text-[15px] leading-normal text-muted">
        {ctx.household.name} is ready. Share this code so housemates can join.
      </p>
      {code ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-500 bg-white p-6">
          <span className="text-[13px] font-semibold text-muted">Invite code</span>
          <span className="font-display text-[34px] font-bold tracking-[0.08em] text-brand-900">{code}</span>
          <CopyButton text={code} />
          <span className="text-[13px] text-muted">Expires in 7 days.</span>
        </div>
      ) : (
        <p className="m-0 text-[15px]">Ask your household organizer for an invite code.</p>
      )}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {['Housemates join with the code.', 'Add your chores and how much effort each takes.', 'PamojaHome shares out the first week fairly.'].map((s, i) => (
          <li key={s} className="flex items-center gap-3 text-[15px]">
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-sun font-bold text-ink">{i + 1}</span>{s}
          </li>
        ))}
      </ol>
      <Link href="/me/chores" className={buttonStyles.primary}>Add chores</Link>
      <Link href="/" className={buttonStyles.secondary}>Go to my household</Link>
    </Screen>
  );
}
