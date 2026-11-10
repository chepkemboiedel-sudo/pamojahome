// How a member's load is built from their history (DD-05, revised 2026-11-10).
// Mirrors load_points in the member_workload database view, so the server can
// pass either one to the engine.

/** Share of a missed chore's effort that counts toward load, in percent. Chosen by simulation. */
export const DEFAULT_MISSED_WEIGHT_PCT = 50;

export interface LoadParts {
  /** Effort of confirmed chores. */
  confirmed: number;
  /** Workload adjustments, e.g. rejoin baselines (US-34). */
  adjustments: number;
  /** Effort of chores marked missed. */
  missed: number;
}

export function memberLoad(p: LoadParts, missedWeightPct = DEFAULT_MISSED_WEIGHT_PCT): number {
  if (!(missedWeightPct >= 0 && missedWeightPct <= 100)) {
    throw new RangeError('missedWeightPct must be between 0 and 100');
  }
  // Rounded to cents of a point, like the numeric(12,2) view column.
  return Math.round((p.confirmed + p.adjustments + (p.missed * missedWeightPct) / 100) * 100) / 100;
}
