# PamojaHome

**Share the work. Share the costs. Keep it fair.** *Pamoja* means "together" in Swahili.

PamojaHome is a household app for roommates and families. It shares out chores by workload rather than simple turns, and it tracks shared expenses. The research question: does a workload-aware allocation rule share chores more fairly than basic rotation?

## What's in this repository

| Folder | What it is | Tests |
| --- | --- | --- |
| `apps/web` | The Next.js app (App Router, TypeScript, Tailwind) | 14 unit tests, 16-step end-to-end walkthrough |
| `packages/engine` | The allocation engine (DD-05), shared by the app and the research simulation | 21 tests |
| `packages/engine/results` | Simulation results: 4 scenarios × 2,000 households, with figures | — |
| `supabase` | Database schema, row-level security, database functions and scheduled jobs (5 migrations) | 82 checks |

## How it fits together

```
Browser ──▶ Next.js on Vercel ──▶ Supabase (Postgres + Auth)
              │  server actions call database functions with the user's session;
              │  row-level security limits every query to the user's household
              │
Supabase Cron ─hourly, Mondays─▶ POST /api/cron/allocate  (Bearer CRON_SECRET)
              │  runs the shared engine on each member's load_points and
              └─ writes the week with apply_allocation (one transaction, safe to repeat)
```

- **Every write goes through a database function.** The app never inserts or updates tables directly.
- **The weekly job is the only code that uses the service-role key.** An organizer can also start the first week by hand, which runs the same job.
- **Load is confirmed effort, plus adjustments, plus missed chores at 50%.** The simulation picked that weight; organizers can change it with `set_missed_chore_weight`.

## Run it locally

You need Node 20+, Postgres 16 server binaries and a [PostgREST](https://github.com/PostgREST/postgrest/releases) binary.

```bash
npm install
POSTGREST_BIN=/path/to/postgrest npm run local:db   # Postgres + PostgREST + local auth on :54321
cp supabase/local/.data/web.env apps/web/.env.local
npm run dev                                         # http://localhost:3000
```

The local backend applies all migrations to a fresh database, so you test the same row-level security that production uses. Its sign-in service is a stand-in for Supabase Auth; never deploy it. Stop everything with `bash supabase/local/stop.sh`.

## Tests

```bash
npm test                                   # engine, database and web unit tests
node apps/web/e2e/flow.mjs                 # end-to-end walkthrough (app and local backend running; needs Playwright)
npm run simulate                           # rerun the research simulation (about 30 s)
```

The end-to-end walkthrough covers:

- sign-up and household setup;
- invite codes, including a wrong code;
- organizer-only chore management and per-member ratings;
- sharing out the week;
- the cron endpoint's secret and its safe repeat;
- marking a chore done and peer confirmation;
- equal and custom expense splits, including double-tapping Save;
- recording a settle-up payment and reversing an entry, with balances still summing to zero;
- an outsider being kept out of the household.

## Deploy

1. Create a Supabase project and enable **Integrations → Cron**. Then run `npx supabase login`, `npx supabase link --project-ref <your-project-ref>` and `npx supabase db push --remote` (see `supabase/README.md`).
2. Deploy `apps/web` to Vercel with the variables in `apps/web/.env.example`.
3. In Supabase, schedule the commented `pamoja-weekly-allocation` job from migration 3 (hourly on Mondays): a `net.http_post` to `https://<your-app>/api/cron/allocate` with the header `Authorization: Bearer <CRON_SECRET>` (see `supabase/README.md`).

## Status

**Built:**

- sign-up and sign-in;
- creating and joining households, and invite codes;
- adding chores and rating preferences;
- weekly allocation with "Why this is yours";
- marking chores done, undoing, confirming and disputing;
- the workload overview;
- money: adding expenses (equal or custom split), balances, settle-up suggestions, recording payments, and reversing mistakes.

**Next:** recurring bills, one-off tasks, swaps, days unavailable and vacations, effort voting, move-out, and the organizer's dispute review.

## License

[MIT](LICENSE)
