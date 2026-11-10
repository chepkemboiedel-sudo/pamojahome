// Plain-language "Why this is yours" text for the chore detail screen.
// Neutral wording: describes the household, never blames anyone (RC-18).
import type { Assignment } from './types.js';

const PREF_WORD = { prefer: 'Preferred', neutral: 'Neutral', dislike: 'Disliked' } as const;

export function explainAssignment(a: Assignment): string {
  const rated = `You rated this chore ${PREF_WORD[a.preference]}.`;
  switch (a.reason) {
    case 'lowest_load':
      return `You had the lowest workload when this week's chores were shared out. ${rated}`;
    case 'preference':
      return `Your workload was close to the lowest, and you rated this chore ${PREF_WORD[a.preference]}, so it went to you.`;
    case 'tie_break':
      return `You and a housemate had the same workload and preference, so the household's fixed order decided. ${rated}`;
    case 'fallback_unavailable':
      return 'Housemates with a lower workload are away that day, so it went to the person with the lowest workload who is home.';
    case 'rotation':
      return 'Your household uses basic rotation, so this chore came to you in turn.';
  }
}
