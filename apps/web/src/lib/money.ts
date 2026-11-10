// Money is integer cents everywhere (RC-09). These helpers are shared by the
// server actions and the add-expense form, so the preview matches what is saved.

/** Largest single expense or payment the database accepts: $100,000.00. */
export const MAX_CENTS = 10_000_000;

/**
 * Parses what a person typed ("12", "12.5", "$1,234.56") into cents.
 * Returns null for anything else, including more than two decimal places.
 */
export function parseCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents <= MAX_CENTS ? cents : null;
}

/** "$12.50" — always two decimals, no sign. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(cents) / 100);
}

/** Cents as an editable string without a $: 1250 → "12.50". */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

/**
 * Equal split, matching private.insert_expense: everyone gets the floor share and
 * the payer takes the leftover cents (OQ-06).
 */
export function equalShares(totalCents: number, memberIds: string[], payerId: string): Map<string, number> {
  const n = memberIds.length;
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return new Map(memberIds.map((id) => [id, base + (id === payerId ? remainder : 0)]));
}
