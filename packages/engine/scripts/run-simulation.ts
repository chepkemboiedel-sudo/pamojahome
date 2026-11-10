// Runs every scenario and writes results/households.csv and results/summary.json.
// Usage: npm run simulate [-- --households 500]
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCENARIOS, VARIANTS, runScenario, type HouseholdResult } from '../src/simulate.js';

const arg = process.argv.indexOf('--households');
const households = arg > 0 ? Number(process.argv[arg + 1]) : undefined;

const METRICS = ['giniAssigned', 'giniCompleted', 'meanWeeklyGapE', 'boundHeldRate', 'completionRate',
  'dislikedShare', 'preferredShare', 'overloadedShare', 'fallbackRate'] as const;
type Metric = (typeof METRICS)[number];
/** The shipped default: missed chores count at ½ (set_missed_chore_weight). Headline and by-size results use it. */
const SHIPPED_VARIANT = 'workload_half';

/** Paired comparison of one variant against basic rotation, household by household. */
function paired(rows: HouseholdResult[], metric: Metric, variant = 'workload') {
  const rot = rows.filter((r) => r.mode === 'rotation');
  const wl = rows.filter((r) => r.mode === variant);
  const d = wl.map((r, i) => r[metric] - rot[i]![metric]);
  const n = d.length;
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const avg = (xs: HouseholdResult[]) => xs.reduce((a, r) => a + r[metric], 0) / xs.length;
  return {
    rotation: avg(rot), workload: avg(wl), diff: mean, ci95: [mean - 1.96 * se, mean + 1.96 * se],
    effectSizeDz: sd === 0 ? 0 : mean / sd,
    workloadBetterShare: d.filter((x) => (metric === 'completionRate' || metric === 'preferredShare' || metric === 'boundHeldRate' ? x > 1e-12 : x < -1e-12)).length / n,
    tieShare: d.filter((x) => Math.abs(x) <= 1e-12).length / n,
  };
}

mkdirSync('results', { recursive: true });
const all: HouseholdResult[] = [];
const summary: Record<string, unknown> = {};
for (const base of SCENARIOS) {
  const s = households ? { ...base, households } : base;
  const t0 = Date.now();
  const rows = runScenario(s);
  all.push(...rows);
  summary[s.name] = {
    label: s.label, households: s.households, weeks: s.weeks, seed: s.seed,
    headlineVariant: SHIPPED_VARIANT,
    metrics: Object.fromEntries(METRICS.map((m) => [m, paired(rows, m, SHIPPED_VARIANT)])),
    variants: Object.fromEntries(VARIANTS.filter((v) => v.mode === 'workload').map((v) => [v.name, {
      label: v.label, missedWeight: v.missedWeight,
      metrics: Object.fromEntries(METRICS.map((m) => [m, paired(rows, m, v.name)])),
    }])),
    bySizeVariant: SHIPPED_VARIANT,
    bySize: Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((size) => {
      const sub = rows.filter((r) => r.size === size);
      return [size, sub.length ? paired(sub, 'giniAssigned', SHIPPED_VARIANT) : null];
    })),
  };
  const g = (summary[s.name] as any).metrics.giniCompleted;
  const v = (summary[s.name] as any).variants;
  console.log(`${s.label.padEnd(24)} completed Gini  rotation ${g.rotation.toFixed(3)}  ` +
    Object.values(v).map((x: any) => `${x.missedWeight}: ${x.metrics.giniCompleted.workload.toFixed(3)}`).join('  ') +
    `  (${Date.now() - t0} ms)`);
}

const header = ['scenario', 'household', 'size', 'chores', 'mode', ...METRICS, 'unassigned'];
writeFileSync('results/households.csv',
  [header.join(','), ...all.map((r) => header.map((k) => {
    const v = (r as any)[k];
    return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(6) : v;
  }).join(','))].join('\n') + '\n');
writeFileSync('results/summary.json', JSON.stringify(summary, null, 2));
console.log('Wrote results/households.csv and results/summary.json');
