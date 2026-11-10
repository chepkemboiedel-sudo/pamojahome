-- =============================================================================
-- PamojaHome · Migration 1 of 3 · Tables, constraints, ledger rules
-- Target: Supabase Postgres 15+.  Money is always integer cents (RC-09).
-- Traceability: US-## = user stories, RC-## = requirements, DD-## = decisions
-- (PamojaHome SDD v1.0).
-- =============================================================================

create schema if not exists private;          -- helpers, never exposed by the API
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------
create type public.member_role      as enum ('organizer', 'member');
create type public.member_status    as enum ('active', 'moving_out', 'archived');
create type public.allocation_mode  as enum ('workload', 'rotation');                -- US-06
create type public.chore_frequency  as enum ('daily', 'twice_weekly', 'weekly', 'biweekly');
create type public.preference_level as enum ('prefer', 'neutral', 'dislike');        -- US-07
create type public.absence_kind     as enum ('day_off', 'vacation');                 -- US-08, US-34
create type public.task_kind        as enum ('scheduled', 'one_off');                -- US-28
create type public.task_status      as enum ('assigned', 'pending_confirmation', 'confirmed',
                                             'escalated', 'missed', 'cancelled');
create type public.task_action      as enum ('assigned', 'marked_done', 'undone', 'confirmed',
                                             'auto_confirmed', 'disputed', 'escalated',
                                             'resolved_done', 'resolved_not_done', 'reassigned',
                                             'missed', 'cancelled');
create type public.swap_status      as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.split_method     as enum ('equal', 'custom', 'itemized');
create type public.expense_source   as enum ('manual', 'recurring', 'receipt');
create type public.receipt_status   as enum ('draft', 'confirmed', 'discarded');
create type public.notify_channel   as enum ('push', 'email');
create type public.notify_type      as enum ('due_soon', 'overdue', 'money_owed', 'weekly_summary',
                                             'confirm_request', 'swap_request', 'dispute_escalated');
create type public.adjustment_reason as enum ('rejoin_baseline', 'correction');

-- -----------------------------------------------------------------------------
-- People and households
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at    timestamptz not null default now()
);
comment on table public.profiles is 'One row per signed-up user. Minimal personal data (RC-05).';

create table public.households (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (char_length(btrim(name)) between 1 and 80),
  timezone                 text not null default 'UTC',                     -- RC-13
  allocation_mode          public.allocation_mode not null default 'workload',
  chore_credit_enabled     boolean not null default false,                  -- US-35, RC-23
  chore_credit_rate_cents  integer check (chore_credit_rate_cents between 1 and 10000),
  research_salt            uuid not null default gen_random_uuid(),         -- RC-06 pseudonyms
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint credit_needs_rate check (not chore_credit_enabled or chore_credit_rate_cents is not null)
);

-- A member row outlives the user's account so the ledger stays whole (RC-14).
create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 60),
  role          public.member_role   not null default 'member',
  status        public.member_status not null default 'active',
  rotation_position integer not null default 0,                              -- basic rotation order
  joined_at     timestamptz not null default now(),
  move_out_on   date,                                                         -- US-29
  archived_at   timestamptz,
  unique (household_id, user_id),
  unique (household_id, id),                                                  -- composite FK target
  constraint archived_has_time check ((status = 'archived') = (archived_at is not null))
);
create index on public.household_members (user_id) where status <> 'archived';

create table public.invites (                                                 -- US-03
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  code          text not null unique check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  revoked_at    timestamptz,
  foreign key (household_id, created_by) references public.household_members (household_id, id)
);

-- -----------------------------------------------------------------------------
-- Chores, effort, preferences, availability
-- -----------------------------------------------------------------------------
create table public.chores (                                                  -- US-05
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  frequency         public.chore_frequency not null,
  organizer_effort  smallint not null check (organizer_effort between 1 and 5),
  effort            smallint not null check (effort between 1 and 5),        -- effective value (US-30)
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (household_id, id)
);
create unique index chores_unique_active_name on public.chores (household_id, lower(name)) where active;

create table public.effort_votes (                                            -- US-30, DD-11
  chore_id      uuid not null,
  household_id  uuid not null,
  member_id     uuid not null,
  effort        smallint not null check (effort between 1 and 5),
  updated_at    timestamptz not null default now(),
  primary key (chore_id, member_id),
  foreign key (household_id, chore_id)  references public.chores (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

create table public.chore_preferences (                                       -- US-07
  chore_id      uuid not null,
  household_id  uuid not null,
  member_id     uuid not null,
  preference    public.preference_level not null default 'neutral',
  updated_at    timestamptz not null default now(),
  primary key (chore_id, member_id),
  foreign key (household_id, chore_id)  references public.chores (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

create table public.absences (                                                -- US-08, US-34
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  member_id     uuid not null,
  kind          public.absence_kind not null,
  starts_on     date not null,
  ends_on       date not null,
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366),
  foreign key (household_id, member_id) references public.household_members (household_id, id) on delete cascade
);
create index on public.absences (household_id, starts_on);

-- -----------------------------------------------------------------------------
-- Scheduling and tasks
-- -----------------------------------------------------------------------------
create table public.scheduling_periods (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  starts_on        date not null,
  ends_on          date not null,
  allocation_mode  public.allocation_mode not null,                          -- mode used (US-06)
  generated_at     timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (household_id, starts_on),
  unique (household_id, id)
);

-- One row per chore occurrence or one-off task. Effort is snapshotted when the
-- task is created so later votes never change past workload (US-30).
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null,
  period_id         uuid,
  chore_id          uuid,
  kind              public.task_kind not null default 'scheduled',
  title             text not null check (char_length(btrim(title)) between 1 and 120),
  member_id         uuid not null,                                            -- assignee / logger
  due_on            date,
  effort            smallint not null check (effort between 1 and 5),
  status            public.task_status not null default 'assigned',
  completed_at      timestamptz,
  reported_minutes  integer check (reported_minutes between 1 and 1440),     -- US-37 input
  confirmed_at      timestamptz,
  dispute_count     smallint not null default 0 check (dispute_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.household_members (household_id, id),
  foreign key (household_id, period_id) references public.scheduling_periods (household_id, id) on delete cascade,
  foreign key (household_id, chore_id)  references public.chores (household_id, id),
  constraint scheduled_has_chore check (kind = 'one_off' or (chore_id is not null and period_id is not null)),
  constraint done_has_time check (status not in ('pending_confirmation', 'confirmed') or completed_at is not null),
  constraint confirmed_has_time check ((status = 'confirmed') = (confirmed_at is not null))
);
create index on public.tasks (household_id, member_id, status);
create index tasks_pending_idx on public.tasks (completed_at) where status = 'pending_confirmation';
create index on public.tasks (period_id);

-- Append-only audit of everything that happens to a task (dispute review, US-33).
create table public.task_events (
  id               bigint generated always as identity primary key,
  household_id     uuid not null,
  task_id          uuid not null,
  actor_member_id  uuid,                                                      -- null = system
  action           public.task_action not null,
  note             text check (char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, actor_member_id) references public.household_members (household_id, id)
);
create index on public.task_events (task_id, created_at);

create table public.swap_requests (                                           -- US-13
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null,
  task_id            uuid not null,                                           -- requester's task
  requester_id       uuid not null,
  target_member_id   uuid not null,
  target_task_id     uuid,                                                    -- offered in exchange
  status             public.swap_status not null default 'pending',
  created_at         timestamptz not null default now(),
  responded_at       timestamptz,
  check (requester_id <> target_member_id),
  foreign key (household_id, task_id)          references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, target_task_id)   references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, requester_id)     references public.household_members (household_id, id),
  foreign key (household_id, target_member_id) references public.household_members (household_id, id)
);
create unique index one_pending_swap_per_task on public.swap_requests (task_id) where status = 'pending';

-- Points added outside normal tasks, such as rejoining at the household minimum
-- after vacation (DD-05, US-34). Append-only.
create table public.workload_adjustments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  member_id     uuid not null,
  points        integer not null check (points <> 0),
  reason        public.adjustment_reason not null,
  created_at    timestamptz not null default now(),
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

-- -----------------------------------------------------------------------------
-- Money: an append-only ledger (RC-08). Balances are always computed, never stored.
-- -----------------------------------------------------------------------------
create table public.recurring_expenses (                                      -- US-27
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null,
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  amount_cents   bigint not null check (amount_cents between 1 and 10000000),
  paid_by        uuid not null,
  day_of_month   smallint not null check (day_of_month between 1 and 28),
  active         boolean not null default true,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, paid_by)    references public.household_members (household_id, id),
  foreign key (household_id, created_by) references public.household_members (household_id, id)
);

create table public.receipts (                                                -- US-36, RC-22
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  uploaded_by    uuid not null,
  storage_path   text not null,                                              -- receipts/<household>/<id>.jpg
  status         public.receipt_status not null default 'draft',
  extracted      jsonb,                                                       -- AI draft line items
  total_cents    bigint check (total_cents > 0),
  expense_id     uuid,
  created_at     timestamptz not null default now(),
  delete_after   timestamptz not null default now() + interval '30 days',
  unique (household_id, id),
  foreign key (household_id, uploaded_by) references public.household_members (household_id, id)
);

create table public.expenses (                                                -- US-15
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id),
  description            text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents           bigint not null check (amount_cents between 1 and 10000000),
  paid_by                uuid not null,
  split_method           public.split_method not null,
  source                 public.expense_source not null default 'manual',
  recurring_expense_id   uuid,
  receipt_id             uuid,
  spent_on               date not null default current_date,
  created_by             uuid not null,
  created_at             timestamptz not null default now(),
  idempotency_key        uuid not null,                                       -- RC-16
  unique (household_id, idempotency_key),
  unique (household_id, id),
  foreign key (household_id, paid_by)    references public.household_members (household_id, id),
  foreign key (household_id, created_by) references public.household_members (household_id, id),
  foreign key (household_id, recurring_expense_id) references public.recurring_expenses (household_id, id),
  foreign key (household_id, receipt_id) references public.receipts (household_id, id)
);
create index on public.expenses (household_id, created_at desc);

create table public.expense_shares (
  expense_id    uuid not null,
  household_id  uuid not null,
  member_id     uuid not null,
  share_cents   bigint not null check (share_cents >= 0),
  primary key (expense_id, member_id),
  foreign key (household_id, expense_id) references public.expenses (household_id, id),
  foreign key (household_id, member_id)  references public.household_members (household_id, id)
);

create table public.recurring_runs (                                          -- exactly once per cycle (RC-20)
  recurring_expense_id  uuid not null,
  household_id          uuid not null,
  cycle_on              date not null,
  expense_id            uuid not null,
  created_at            timestamptz not null default now(),
  primary key (recurring_expense_id, cycle_on),
  foreign key (household_id, recurring_expense_id) references public.recurring_expenses (household_id, id),
  foreign key (household_id, expense_id) references public.expenses (household_id, id)
);

create table public.payments (                                                -- US-18, RC-10
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id),
  from_member_id   uuid not null,
  to_member_id     uuid not null,
  amount_cents     bigint not null check (amount_cents between 1 and 10000000),
  paid_on          date not null default current_date,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  idempotency_key  uuid not null,
  check (from_member_id <> to_member_id),
  unique (household_id, idempotency_key),
  unique (household_id, id),
  foreign key (household_id, from_member_id) references public.household_members (household_id, id),
  foreign key (household_id, to_member_id)   references public.household_members (household_id, id),
  foreign key (household_id, created_by)     references public.household_members (household_id, id)
);

create table public.credit_consents (                                         -- unanimous opt-in (RC-23)
  household_id  uuid not null,
  member_id     uuid not null,
  agreed_at     timestamptz not null default now(),
  primary key (household_id, member_id),
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

create table public.chore_credits (                                           -- US-35
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id),
  earner_id        uuid not null,
  period_month     date not null check (extract(day from period_month) = 1),
  points           integer not null check (points between 1 and 500),
  rate_cents       integer not null check (rate_cents between 1 and 10000),
  amount_cents     bigint generated always as (points::bigint * rate_cents) stored,
  created_at       timestamptz not null default now(),
  idempotency_key  uuid not null,
  unique (household_id, idempotency_key),
  unique (household_id, id),
  foreign key (household_id, earner_id) references public.household_members (household_id, id)
);

create table public.chore_credit_shares (
  credit_id     uuid not null,
  household_id  uuid not null,
  member_id     uuid not null,                                              -- who pays for the credit
  amount_cents  bigint not null check (amount_cents >= 0),
  primary key (credit_id, member_id),
  foreign key (household_id, credit_id) references public.chore_credits (household_id, id),
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

-- A correction never edits an entry; it points at it (US-19). Each entry can be
-- reversed at most once, and only inside its own household.
create table public.reversals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id),
  expense_id    uuid unique,
  payment_id    uuid unique,
  credit_id     uuid unique,
  reason        text check (char_length(reason) <= 200),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  check (num_nonnulls(expense_id, payment_id, credit_id) = 1),
  foreign key (household_id, expense_id) references public.expenses (household_id, id),
  foreign key (household_id, payment_id) references public.payments (household_id, id),
  foreign key (household_id, credit_id)  references public.chore_credits (household_id, id),
  foreign key (household_id, created_by) references public.household_members (household_id, id)
);

-- -----------------------------------------------------------------------------
-- Notifications (Phase 2)
-- -----------------------------------------------------------------------------
create table public.notification_preferences (                                -- opt-in, RC-21
  user_id     uuid not null references auth.users (id) on delete cascade,
  channel     public.notify_channel not null,
  type        public.notify_type not null,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, channel, type)
);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz not null default now()
);

create table public.notification_outbox (                                     -- written by server only
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null,
  channel       public.notify_channel not null,
  type          public.notify_type not null,
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text not null unique,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  error         text,
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);
create index outbox_unsent_idx on public.notification_outbox (created_at) where sent_at is null;

create table public.weekly_summaries (                                        -- US-32
  household_id  uuid not null references public.households (id) on delete cascade,
  week_start    date not null,
  summary       jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (household_id, week_start)
);

-- -----------------------------------------------------------------------------
-- Compatibility check (Phase 2). Candidates never get an account (RC-07).
-- -----------------------------------------------------------------------------
create table public.candidate_invites (                                       -- US-24
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  created_by    uuid not null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 60),
  token_hash    text not null unique,                                        -- sha-256 of the guest token
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  submitted_at  timestamptz,
  delete_after  timestamptz not null default now() + interval '30 days',
  unique (household_id, id),
  foreign key (household_id, created_by) references public.household_members (household_id, id)
);

create table public.candidate_preferences (                                   -- US-25
  invite_id     uuid not null,
  household_id  uuid not null,
  chore_id      uuid not null,
  preference    public.preference_level not null,
  primary key (invite_id, chore_id),
  foreign key (household_id, invite_id) references public.candidate_invites (household_id, id) on delete cascade,
  foreign key (household_id, chore_id)  references public.chores (household_id, id) on delete cascade
);

create table public.candidate_away_days (
  invite_id     uuid not null,
  household_id  uuid not null,
  weekday       smallint not null check (weekday between 0 and 6),          -- 0 = Monday
  primary key (invite_id, weekday),
  foreign key (household_id, invite_id) references public.candidate_invites (household_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Research consent (RC-06)
-- -----------------------------------------------------------------------------
create table public.research_consents (
  household_id  uuid not null,
  member_id     uuid not null,
  consented_at  timestamptz not null default now(),
  withdrawn_at  timestamptz,
  primary key (household_id, member_id),
  foreign key (household_id, member_id) references public.household_members (household_id, id)
);

-- =============================================================================
-- Ledger integrity triggers
-- =============================================================================

-- 1. Append-only: no UPDATE, DELETE or TRUNCATE, for anyone, including the
--    service role (RC-08). Corrections are rows in public.reversals.
create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'PamojaHome: % is append-only; record a reversal instead', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['expenses', 'expense_shares', 'payments', 'chore_credits',
                           'chore_credit_shares', 'reversals', 'recurring_runs',
                           'task_events', 'workload_adjustments']
  loop
    execute format('create trigger %I before update or delete on public.%I
                    for each row execute function private.forbid_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I
                    for each statement execute function private.forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- 2. Shares must add up exactly to the total, checked at commit so the header
--    and its shares are written together in one transaction (RC-09, RC-16).
create function private.assert_expense_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare
  eid uuid := (to_jsonb(new) ->> case when tg_table_name = 'expenses' then 'id' else 'expense_id' end)::uuid;
  total bigint; sum_shares bigint; n int;
begin
  select e.amount_cents into total from public.expenses e where e.id = eid;
  select coalesce(sum(s.share_cents), 0), count(*) into sum_shares, n
    from public.expense_shares s where s.expense_id = eid;
  if n = 0 or sum_shares <> total then
    raise exception 'PamojaHome: shares (% cents) must add up to the expense total (% cents)', sum_shares, total
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger expenses_balanced after insert on public.expenses
  deferrable initially deferred for each row execute function private.assert_expense_balanced();
create constraint trigger expense_shares_balanced after insert on public.expense_shares
  deferrable initially deferred for each row execute function private.assert_expense_balanced();

create function private.assert_credit_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare
  cid uuid := (to_jsonb(new) ->> case when tg_table_name = 'chore_credits' then 'id' else 'credit_id' end)::uuid;
  total bigint; sum_shares bigint; n int;
begin
  select c.amount_cents into total from public.chore_credits c where c.id = cid;
  select coalesce(sum(s.amount_cents), 0), count(*) into sum_shares, n
    from public.chore_credit_shares s where s.credit_id = cid;
  if n = 0 or sum_shares <> total then
    raise exception 'PamojaHome: credit shares (% cents) must add up to the credit (% cents)', sum_shares, total
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger chore_credits_balanced after insert on public.chore_credits
  deferrable initially deferred for each row execute function private.assert_credit_balanced();
create constraint trigger chore_credit_shares_balanced after insert on public.chore_credit_shares
  deferrable initially deferred for each row execute function private.assert_credit_balanced();

-- 3. Keep updated_at honest on the few mutable tables.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger households_touch          before update on public.households          for each row execute function private.touch_updated_at();
create trigger chores_touch              before update on public.chores              for each row execute function private.touch_updated_at();
create trigger tasks_touch               before update on public.tasks               for each row execute function private.touch_updated_at();
create trigger recurring_expenses_touch  before update on public.recurring_expenses  for each row execute function private.touch_updated_at();

-- 4. A chore's effort is the median of members' votes once two or more have
--    voted, otherwise the organizer's value (US-30, DD-11). Median rounds half up.
create function private.recompute_chore_effort(p_chore uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare votes int; med numeric;
begin
  select count(*), percentile_cont(0.5) within group (order by v.effort)
    into votes, med
    from public.effort_votes v where v.chore_id = p_chore;
  update public.chores c
     set effort = case when votes >= 2 then floor(med + 0.5)::smallint else c.organizer_effort end
   where c.id = p_chore;
end $$;

create function private.effort_votes_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.recompute_chore_effort(coalesce(new.chore_id, old.chore_id));
  return null;
end $$;

create trigger effort_votes_recompute after insert or update or delete on public.effort_votes
  for each row execute function private.effort_votes_changed();

-- 5. New auth user -> profile row (standard Supabase pattern).
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
                           split_part(new.email, '@', 1), 'Member'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
