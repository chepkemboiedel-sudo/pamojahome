import type { Metadata } from 'next';
import Link from 'next/link';
import { signIn, signUp } from '@/app/actions';
import { Field, Notice, Screen } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const isSignUp = sp.mode === 'signup';
  const tab = (active: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-[10px] text-[15px] font-semibold ${active ? 'bg-white text-brand-900 shadow-sm' : 'text-muted'}`;
  return (
    <Screen nav={false}>
      <div className="relative -mx-5 -mt-5 overflow-hidden bg-brand px-6 pb-10 pt-14 text-white">
        <span aria-hidden="true" className="absolute -right-10 -top-10 size-44 rounded-full bg-accent/70" />
        <span aria-hidden="true" className="absolute -bottom-14 -right-6 size-28 rounded-full bg-sun/90" />
        <h1 className="relative m-0 text-[34px] font-bold leading-tight">PamojaHome</h1>
        <p className="relative mt-2 mb-0 max-w-64 text-[17px] leading-snug">Share the work. Share the costs. Keep it fair.</p>
        <p className="relative mt-3 mb-0 text-sm text-brand-100"><em>Pamoja</em> means “together” in Swahili.</p>
      </div>

      <div role="tablist" aria-label="Account" className="flex gap-1 rounded-xl bg-brand-100 p-1">
        <Link role="tab" aria-selected={!isSignUp} href="/sign-in" className={tab(!isSignUp)}>Sign in</Link>
        <Link role="tab" aria-selected={isSignUp} href="/sign-in?mode=signup" className={tab(isSignUp)}>Create account</Link>
      </div>

      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}

      <form action={isSignUp ? signUp : signIn} className="flex flex-col gap-4">
        {isSignUp && <Field id="name" label="Your name" autoComplete="name" placeholder="Amani" required maxLength={60} />}
        <Field id="email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" required />
        <Field id="password" label="Password" type="password" required minLength={isSignUp ? 8 : undefined}
          autoComplete={isSignUp ? 'new-password' : 'current-password'} hint={isSignUp ? 'At least 8 characters.' : undefined} />
        <SubmitButton pendingText={isSignUp ? 'Creating account…' : 'Signing in…'}>
          {isSignUp ? 'Create account' : 'Sign in'}
        </SubmitButton>
      </form>
      <p className="m-0 text-center text-[13px] text-muted">
        Your household’s data is visible only to its members.
      </p>
    </Screen>
  );
}
