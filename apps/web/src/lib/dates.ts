import { addDays } from '@pamojahome/allocation-engine';

/** Today's date (YYYY-MM-DD) in a household's time zone (RC-13). */
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The Monday on or before a date. */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** Whole weeks from one Monday to another. */
export function weeksBetween(fromMonday: string, toMonday: string): number {
  return Math.round((Date.parse(toMonday) - Date.parse(fromMonday)) / (7 * 86_400_000));
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));

/** "Tue, Nov 10" */
export const shortDate = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Today", "Tomorrow", or "Tue, Nov 10". */
export function dueLabel(iso: string, today: string): string {
  if (iso === today) return 'Due today';
  if (iso === addDays(today, 1)) return 'Due tomorrow';
  if (iso < today) return `Was due ${shortDate(iso)}`;
  return shortDate(iso);
}

/** "Nov 9–15" or "Nov 30 – Dec 6". */
export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  const m1 = fmt(monday, { month: 'short' });
  const m2 = fmt(sunday, { month: 'short' });
  const d1 = fmt(monday, { day: 'numeric' });
  const d2 = fmt(sunday, { day: 'numeric' });
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${m1} ${d1} – ${m2} ${d2}`;
}

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
