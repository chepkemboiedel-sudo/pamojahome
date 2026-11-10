# PamojaHome database

The Supabase (Postgres) schema and security rules for PamojaHome: 31 tables, 3 computed views, and 32 database functions that the app calls for every change. See SDD Section 5.3 for the design and the ER diagram.

## Files

| Path | What it contains |
| --- | --- |
| `migrations/20261110000001_schema.sql` | Tables, constraints, append-only ledger triggers, share-sum checks, effort-median trigger, new-user profile trigger |
| `migrations/20261110000002_security.sql` | Row-level security policies, balance and workload views, all write functions (households, chores, tasks, money, credit, scheduled jobs) |
| `migrations/20261110000003_grants_jobs_storage.sql` | Table and function permissions, Supabase Cron jobs, private `receipts` storage bucket |
| `migrations/20261110000004_missed_chore_weight.sql` | Missed chores count at partial weight (default 50%) toward workload: `missed_weight_pct` setting, `missed_points` and `load_points` in `member_workload`, `set_missed_chore_weight` (DD-05) |
| `migrations/20261110000005_apply_allocation.sql` | `apply_allocation`: writes a week's period, tasks, rejoin adjustments and each task's "Why this is yours" reason in one transaction; a repeated run changes nothing (service role only) |
| `local/` | Local backend for development and end-to-end tests: Postgres 16, PostgREST and a stand-in for Supabase Auth (never deploy) |
| `tests/supabase_stubs.sql` | Stand-ins for Supabase's `auth` and `storage` schemas so the tests run on plain Postgres |
| `tests/schema.test.mjs` | 82 automated checks of the rules |

## Run the tests

```bash
npm install
npm test
```

The tests run the five migrations on PGlite (Postgres 16 in WebAssembly), so no database server is needed.

## Apply to Supabase

1. Install the Supabase CLI and link your project.
2. From the repository root, run `supabase db push` (the migrations are in `supabase/migrations/`).
3. In the Supabase dashboard, enable **Integrations → Cron** (pg_cron) **before** running migration 3, so its scheduled jobs are created. If you enable it later, rerun the `cron.schedule` block from migration 3.
4. For jobs that call the app (weekly allocation, notifications, purge), store `app_url` and `cron_secret` in Supabase Vault, enable `pg_net`, and add the commented `net.http_post` jobs from migration 3.

## How the app uses it

- **Reads:** query tables and the `member_balances` / `member_workload` views with the signed-in user's session. Row-level security returns only that user's household.
- **Writes:** call the functions with `supabase.rpc('record_expense', {...})`, and so on. Direct inserts and updates are refused.
- **Allocation:** the Vercel server writes `scheduling_periods`, `tasks` and `workload_adjustments` with the service-role key, after running the shared allocation engine on each member's `load_points`.
- **Money:** every amount is integer cents. Send an idempotency key (a UUID made on the client) with each expense, payment or credit, so retries are safe.
