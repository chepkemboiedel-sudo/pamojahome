// Types shared by the live app and the research simulation (RC-12).

export type Preference = 'prefer' | 'neutral' | 'dislike';
export type Frequency = 'daily' | 'twice_weekly' | 'weekly' | 'biweekly';
export type AllocationMode = 'workload' | 'rotation';

/** A chore as defined by the household (US-05). */
export interface Chore {
  id: string;
  name: string;
  /** Effective effort 1–5 (organizer value or median vote, US-30). */
  effort: number;
  frequency: Frequency;
  /** Fixed order used to break ties deterministically (RC-11). */
  sortOrder: number;
}

/** A household member as the engine sees them at the start of a period. */
export interface Member {
  id: string;
  /** Position in the basic rotation and the final tie-breaker. */
  rotationPosition: number;
  /** Confirmed effort + adjustments + weighted missed effort (memberLoad, member_workload.load_points). */
  load: number;
  /** ISO dates (YYYY-MM-DD) in this period when the member cannot take chores (US-08, US-34). */
  unavailableDates: string[];
  /** Chore id → preference. Missing = neutral (US-07). */
  preferences: Record<string, Preference>;
  /** True when the member is back from an absence that excused them from the comparison (US-34). */
  returningFromAbsence?: boolean;
}

export interface Period {
  /** First day of the period, a Monday, as YYYY-MM-DD. */
  startsOn: string;
  /** 0, 1, 2… counted from the household's first period; decides biweekly weeks and rotation offset. */
  index: number;
}

/** One concrete thing to do on one day. */
export interface ChoreInstance {
  choreId: string;
  name: string;
  effort: number;
  dueOn: string;
  sortOrder: number;
}

export interface Assignment extends ChoreInstance {
  memberId: string;
  /** Why this member got it, for the "Why this is yours" text (DD-05 explainability). */
  reason: 'lowest_load' | 'preference' | 'tie_break' | 'fallback_unavailable' | 'rotation';
  /** The assignee's preference for this chore. */
  preference: Preference;
}

export interface Adjustment {
  memberId: string;
  points: number;
  reason: 'rejoin_baseline';
}

export interface AllocationResult {
  mode: AllocationMode;
  assignments: Assignment[];
  /** Points added before allocating so returning members rejoin at the household minimum. */
  adjustments: Adjustment[];
  /** Each member's load after this period's assignments (projected, assuming completion). */
  projectedLoads: Record<string, number>;
  /** Largest chore effort E used for the bound. */
  largestEffort: number;
  /** max − min projected load among members available this period. */
  gap: number;
  /** True when gap ≤ E (US-09). */
  boundHeld: boolean;
  /** Instances where no eligible member was free that day and the engine had to fall back. */
  fallbacks: number;
}
