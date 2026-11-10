import type { Metadata } from 'next';
import Link from 'next/link';
import { getContext } from '@/lib/household';
import { createClient } from '@/lib/supabase/server';
import { saveChore, setPreference, shareOutThisWeek } from '@/app/actions';
import { Card, Field, Icon, Notice, Screen, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

export const metadata: Metadata = { title: 'Chores' };

const FREQ = [['daily', 'Daily'], ['twice_weekly', 'Twice a week'], ['weekly', 'Weekly'], ['biweekly', 'Every two weeks']] as const;
const PREFS = [['prefer', 'Prefer'], ['neutral', 'Neutral'], ['dislike', 'Dislike']] as const;

export default async function ManageChoresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const supabase = await createClient();
  const [{ data: chores }, { data: prefs }, { data: period }] = await Promise.all([
    supabase.from('chores').select('id, name, frequency, effort, active').eq('household_id', ctx.household.id)
      .eq('active', true).order('sort_order'),
    supabase.from('chore_preferences').select('chore_id, preference').eq('member_id', ctx.memberId),
    supabase.from('scheduling_periods').select('id').eq('household_id', ctx.household.id).eq('starts_on', ctx.weekStart).maybeSingle(),
  ]);
  const myPref = new Map((prefs ?? []).map((p) => [p.chore_id, p.preference]));
  const organizer = ctx.role === 'organizer';

  return (
    <Screen>
      <Link href="/me" className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-brand-900">
        <Icon.Back /> Me
      </Link>
      <h1 className="m-0 text-[28px] font-bold">Chores</h1>
      <p className="m-0 text-[15px] leading-normal text-muted">
        Rate each chore. Preferences decide who gets a chore only when workloads are already close, so fairness comes first.
      </p>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {(chores ?? []).map((c) => {
          const current = myPref.get(c.id) ?? 'neutral';
          return (
            <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold">{c.name}</span>
                <span className="text-[13px] text-muted">{FREQ.find(([v]) => v === c.frequency)?.[1]} · Effort {c.effort}</span>
              </div>
              <fieldset className="m-0 border-0 p-0">
                <legend className="sr-only">Your preference for {c.name}</legend>
                <div className="flex gap-1 rounded-[10px] bg-page p-1">
                  {PREFS.map(([value, label]) => (
                    <form key={value} action={setPreference} className="flex-1">
                      <input type="hidden" name="chore" value={c.id} />
                      <input type="hidden" name="preference" value={value} />
                      <button aria-pressed={current === value}
                        className={`min-h-10 w-full rounded-lg text-sm font-semibold ${current === value ? 'bg-white text-brand-900 shadow-sm' : 'text-muted'}`}>
                        {label}
                      </button>
                    </form>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      {(chores ?? []).length === 0 && <Notice>{organizer ? 'No chores yet. Add the first one below.' : 'Your organizer hasn’t added chores yet.'}</Notice>}

      {organizer && (
        <Card labelledBy="add-h">
          <SectionTitle id="add-h">Add a chore</SectionTitle>
          <form action={saveChore} className="flex flex-col gap-4">
            <Field id="name" label="Chore" placeholder="Clean bathroom" required maxLength={80} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="frequency" className="text-sm font-semibold">How often</label>
              <select id="frequency" name="frequency" defaultValue="weekly"
                className="min-h-12 rounded-xl border border-control bg-white px-3 text-base">
                {FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 text-sm font-semibold">Effort</legend>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-control bg-white text-base font-semibold has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white">
                    <input type="radio" name="effort" value={n} defaultChecked={n === 3} className="sr-only" />{n}
                  </label>
                ))}
              </div>
              <span className="text-[13px] text-muted">1 = a few minutes · 5 = an hour or more of hard work. Housemates can vote to adjust it.</span>
            </fieldset>
            <SubmitButton>Add chore</SubmitButton>
          </form>
        </Card>
      )}
      {organizer && !period && (chores ?? []).length > 0 && (
        <form action={shareOutThisWeek}><SubmitButton variant="secondary" className="w-full" pendingText="Sharing out…">Share out this week’s chores</SubmitButton></form>
      )}
    </Screen>
  );
}
