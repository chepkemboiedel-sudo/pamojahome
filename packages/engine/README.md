# PamojaHome allocation engine

The chore allocation engine for PamojaHome, and the simulation that compares it with basic rotation (the research contribution, SDD 1.3). The engine is pure TypeScript with no I/O, clock, or randomness. The app's weekly allocation job and the simulation import the same code (RC-11, RC-12).

## Files

| Path | What it contains |
| --- | --- |
| `src/types.ts` | Chores, members, periods, assignments, results |
| `src/allocate.ts` | Chore expansion, the workload-aware rule (DD-05), the rotation baseline (US-06), rejoin baseline (US-34) |
| `src/load.ts` | `memberLoad`: confirmed + adjustments + missed × weight (default 50%) |
| `src/explain.ts` | Neutral "Why this is yours" text for each assignment reason |
| `src/simulate.ts` | Seeded synthetic households, 12-week runs of both modes on the same random draws |
| `scripts/run-simulation.ts` | Runs four scenarios and writes `results/` |
| `scripts/charts.py` | Draws the figures from `results/` |
| `test/allocate.test.ts` | 21 automated checks (all pass) |
| `results/` | Per-household CSV (4 scenarios × 2,000 households × 4 methods), summary with 95% CIs, three figures |

## Commands

```bash
npm install
npm test                 # 21 tests, including the fairness bound on 5,000 random households
npm run typecheck
npm run simulate         # about 30 seconds; add -- --households 500 for a quicker run
python3 scripts/charts.py
```

## The rule (DD-05)

Each week's chore instances are taken from highest to lowest effort. Let E be the largest chore effort. An instance of effort e may go only to a member who is home that day and whose load is at most the household minimum + (E − e). Among those, the best preference wins, then the lowest load, then the fixed member order. A member's load is their confirmed effort plus adjustments, plus missed chores at half weight (`memberLoad` in `src/load.ts`, the same formula as `load_points` in the database). That default comes from the follow-up experiment below.

**Proven by the tests:** when nobody is away, the gap between the most- and least-loaded members stays within E, and a wider starting gap never widens. Results are identical whatever order the input arrives in. Nobody is given a chore on a day they marked unavailable. When everyone eligible is away that day, the engine falls back to the least-loaded member who is home and counts it.

## Simulation design

- 2,000 households per scenario: 2–8 members, 8–14 chores drawn from an 18-chore catalog, 12 weeks each.
- Each member has a reliability (the chance they complete a chore) and a preference for each chore: 25% prefer, 50% neutral, 25% dislike. A disliked chore is less likely to be done (×0.85 in the baseline).
- Absences: a 10% weekly chance of 1–2 days off, and a 2% weekly chance of a 1–3 week trip.
- Common random numbers: all methods see the same households, absences and completion draws, so differences come only from the allocation rule. Results are paired per household, with 95% confidence intervals.
- Workload is measured per available day, so members are not penalized for excused absences.

| Scenario | Change from baseline |
| --- | --- |
| Baseline | Reliability 0.60–0.98 |
| Less reliable members | Reliability 0.40–0.90, dislike ×0.70 |
| No absences | No days off or trips |
| Frequent absences | 30% weekly days-off chance, 6% weekly trip chance |

## Results (baseline scenario, workload-aware minus rotation)

| Measure | Rotation | Workload-aware | Difference [95% CI] |
| --- | --- | --- | --- |
| Gini of completed work per available day | 0.091 | 0.026 | −0.066 [−0.067, −0.064]; fairer in 96% of households |
| Weeks within the gap ≤ E bound | 9.0% | 99.8% | +90.8 points |
| Chores given to someone who dislikes them | 25.2% | 7.8% | −17.4 points |
| Chores given to someone who prefers them | 25.0% | 50.5% | +25.5 points |
| Completion rate | 76.1% | 77.5% | +1.5 points [+1.3, +1.6] |
| Gini of assigned work per available day | 0.049 | 0.068 | +0.019 [+0.017, +0.021] |
| Members assigned >20% above the household average | 4.9% | 8.8% | +3.9 points |

The pattern holds in all four scenarios (see `results/summary.json`). The rotation gap is largest under frequent absences, where workload-aware cuts the average weekly gap from 1.53 E to 1.01 E.

### The trade-off to discuss

Because load counts only confirmed chores, a member who skips chores is assigned more next week. **Completed work becomes far more even, but assigned work becomes less even**, most of all when members are unreliable (assigned Gini 0.048 → 0.103; 17% of members assigned more than 20% above average). This is how the rule is meant to work, since it stops reliable housemates from carrying everyone else. Still, a user study should check how people feel about it. Variants worth testing:

- Count missed chores at partial weight.
- Cap how much extra a member can be assigned in one week.

### Follow-up experiment: how much should a missed chore count?

The engine stays the same in every variant. The only change is how much a missed chore adds to the member's load (the `member_workload` view): 0 (the current rule), ½, or 1 (the chore counts as if it were done). Each variant is compared with rotation on the same households.

| Baseline scenario | Rotation | Missed = 0 | **Missed = ½** | Missed = 1 |
| --- | --- | --- | --- | --- |
| Gini of completed work | 0.091 | 0.026 | **0.050** | 0.075 |
| Gini of assigned work | 0.049 | 0.068 | **0.034** | 0.017 |
| Members assigned >20% above average | 4.9% | 8.8% | **0.5%** | 0.1% |
| Completion rate | 76.1% | 77.5% | **77.9%** | 78.3% |
| Chores given to someone who dislikes them | 25.2% | 7.8% | **7.8%** | 7.1% |
| Weeks within the gap ≤ E bound | 9.0% | 99.8% | **99.8%** | 99.8% |

How the variants compare:

- **Missed = 0** (the current rule) makes completed work the most even, but it piles assigned work onto people who skip.
- **Missed = 1** makes assigned work the most even, but reliable members end up doing more of the real work.
- **Missed = ½** beats rotation in all four scenarios:
  - completed work: Gini −0.038 to −0.046, all 95% CIs below zero;
  - completion: +1.7 to +2.8 points;
  - overloaded members: −1.7 to −7.4 points;
  - disliked chores: about a third as many.
  
  It is never worse on assigned work. The no-absences difference (+0.0005) has a 95% CI of [−0.0009, +0.0020], which includes zero.

The figure `results/fig_missed_weight_tradeoff.png` shows the trade-off in each scenario.

**Adopted (2026-11-10):** ½ is now the default in DD-05, the engine (`DEFAULT_MISSED_WEIGHT_PCT`) and the database (`households.missed_weight_pct`, organizers change it with `set_missed_chore_weight`), so the user study can vary it.

### Limits

These are synthetic households with assumed behavior. They measure workload balance and completion, but not perceived fairness, which needs the planned user study (SDD 1.3). The ≈0.2% of weeks outside the bound under the workload rule come from absences (fallbacks) and from missed chores that widen the starting gap.
