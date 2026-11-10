-- =============================================================================
-- PamojaHome · Migration 2 of 3 · Security rules, computed views, write functions
--
-- The model, in one paragraph:
--   * Every table has row-level security on (RC-03). Signed-in users can READ
--     rows of households they currently belong to, and nothing else.
--   * Clients cannot INSERT, UPDATE or DELETE household data directly. Every
--     change goes through one of the functions below, which check who is asking
--     and enforce the business rules in the database (RC-02, RC-04).
--   * A handful of personal tables (own absences, notification settings, push
--     subscriptions, research consent) allow direct writes to your own rows.
--   * Balances and workload are views computed from the ledger; nobody can
--     write a balance (RC-04).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Membership helpers (security definer so policies can call them cheaply)
-- -----------------------------------------------------------------------------
create function private.member_id(p_household uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.household_members m
   where m.household_id = p_household and m.user_id = auth.uid() and m.status <> 'archived'
$$;

create function private.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                  where m.household_id = p_household and m.user_id = auth.uid()
                    and m.status <> 'archived')
$$;

create function private.is_organizer(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                  where m.household_id = p_household and m.user_id = auth.uid()
                    and m.status <> 'archived' and m.role = 'organizer')
$$;

create function private.shares_household_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1
                   from public.household_members a
                   join public.household_members b on b.household_id = a.household_id
                  where a.user_id = auth.uid() and a.status <> 'archived'
                    and b.user_id = p_user)
$$;

create function private.require_member(p_household uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare m uuid;
begin
  if auth.uid() is null then
    raise exception 'PamojaHome: sign in first' using errcode = '42501';
  end if;
  m := private.member_id(p_household);
  if m is null then
    raise exception 'PamojaHome: you are not a member of this household' using errcode = '42501';
  end if;
  return m;
end $$;

create function private.require_organizer(p_household uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare m uuid := private.require_member(p_household);
begin
  if not private.is_organizer(p_household) then
    raise exception 'PamojaHome: only the household organizer can do this' using errcode = '42501';
  end if;
  return m;
end $$;

create function private.household_today(p_household uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone h.timezone)::date from public.households h where h.id = p_household   -- RC-13
$$;

-- -----------------------------------------------------------------------------
-- Row-level security: read policies
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','households','household_members','invites','chores','effort_votes',
    'chore_preferences','absences','scheduling_periods','tasks','task_events','swap_requests',
    'workload_adjustments','recurring_expenses','receipts','expenses','expense_shares',
    'recurring_runs','payments','credit_consents','chore_credits','chore_credit_shares',
    'reversals','notification_preferences','push_subscriptions','notification_outbox',
    'weekly_summaries','candidate_invites','candidate_preferences','candidate_away_days',
    'research_consents']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Tables every current member of the household may read.
  foreach t in array array[
    'chores','chore_preferences','absences','scheduling_periods','tasks','task_events',
    'swap_requests','workload_adjustments','recurring_expenses','receipts','expenses',
    'expense_shares','recurring_runs','payments','credit_consents','chore_credits',
    'chore_credit_shares','reversals','weekly_summaries','household_members']
  loop
    execute format($p$create policy members_read on public.%I for select to authenticated
                      using ((select private.is_member(household_id)))$p$, t);
  end loop;

  -- Organizer-only reads.
  foreach t in array array['invites','candidate_invites','candidate_preferences','candidate_away_days']
  loop
    execute format($p$create policy organizer_read on public.%I for select to authenticated
                      using ((select private.is_organizer(household_id)))$p$, t);
  end loop;
end $$;

create policy members_read on public.households for select to authenticated
  using ((select private.is_member(id)));

create policy self_or_housemate_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_household_with(id)));
create policy self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Effort votes are private: each member sees only their own (US-30).
create policy own_vote_read on public.effort_votes for select to authenticated
  using (member_id = (select private.member_id(household_id)));

-- Own absences: read with the household, write your own rows only (US-08, US-34).
create policy own_absence_insert on public.absences for insert to authenticated
  with check (member_id = (select private.member_id(household_id)));
create policy own_absence_update on public.absences for update to authenticated
  using (member_id = (select private.member_id(household_id)))
  with check (member_id = (select private.member_id(household_id)));
create policy own_absence_delete on public.absences for delete to authenticated
  using (member_id = (select private.member_id(household_id)));

-- Personal settings: your rows only (RC-21).
create policy own_rows on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Research consent: your own row (RC-06).
create policy own_consent on public.research_consents for all to authenticated
  using (member_id = (select private.member_id(household_id)))
  with check (member_id = (select private.member_id(household_id)));

-- notification_outbox: no policy for authenticated = no access (server only).

-- -----------------------------------------------------------------------------
-- Computed views. security_invoker = true, so the caller's RLS applies and a
-- member only ever sees their own household (RC-03, RC-04).
-- -----------------------------------------------------------------------------
create view public.member_balances with (security_invoker = true) as
with live_expenses as (
  select e.* from public.expenses e
   where not exists (select 1 from public.reversals r where r.expense_id = e.id)
), live_payments as (
  select p.* from public.payments p
   where not exists (select 1 from public.reversals r where r.payment_id = p.id)
), live_credits as (
  select c.* from public.chore_credits c
   where not exists (select 1 from public.reversals r where r.credit_id = c.id)
), movements as (
  select household_id, paid_by as member_id, amount_cents as delta from live_expenses
  union all
  select s.household_id, s.member_id, -s.share_cents
    from public.expense_shares s join live_expenses e on e.id = s.expense_id
  union all
  select household_id, from_member_id, amount_cents from live_payments
  union all
  select household_id, to_member_id, -amount_cents from live_payments
  union all
  select household_id, earner_id, amount_cents from live_credits
  union all
  select s.household_id, s.member_id, -s.amount_cents
    from public.chore_credit_shares s join live_credits c on c.id = s.credit_id
)
select m.household_id,
       m.id as member_id,
       m.display_name,
       m.status,
       coalesce(sum(mv.delta), 0)::bigint as balance_cents      -- > 0: is owed, < 0: owes
  from public.household_members m
  left join movements mv on mv.member_id = m.id
 group by m.household_id, m.id, m.display_name, m.status;
comment on view public.member_balances is
  'Positive = the household owes this member. All balances in a household sum to zero (US-16).';

create view public.member_workload with (security_invoker = true) as
select m.household_id,
       m.id as member_id,
       m.display_name,
       coalesce((select sum(t.effort) from public.tasks t
                  where t.member_id = m.id and t.status = 'confirmed'), 0)
     + coalesce((select sum(a.points) from public.workload_adjustments a
                  where a.member_id = m.id), 0)                      as confirmed_points,
       coalesce((select sum(t.effort) from public.tasks t
                  where t.member_id = m.id
                    and t.status in ('assigned', 'pending_confirmation', 'escalated')), 0)
                                                                     as open_points
  from public.household_members m
 where m.status <> 'archived';
comment on view public.member_workload is 'Cumulative confirmed effort per member (US-20).';

create view public.reversed_entries with (security_invoker = true) as
select household_id, coalesce(expense_id, payment_id, credit_id) as entry_id,
       case when expense_id is not null then 'expense'
            when payment_id is not null then 'payment' else 'credit' end as entry_kind,
       reason, created_by, created_at
  from public.reversals;

-- Anonymized research export: service role only (RC-06, US-23).
create view public.research_task_export with (security_invoker = true) as
select md5(h.research_salt::text || h.id::text)        as household_ref,
       md5(h.research_salt::text || t.member_id::text) as participant_ref,
       md5(h.research_salt::text || coalesce(t.chore_id::text, 'one_off')) as chore_ref,
       p.starts_on as period_start, p.allocation_mode,
       t.kind, t.effort, t.status, t.due_on, t.completed_at, t.confirmed_at,
       t.reported_minutes, t.dispute_count
  from public.tasks t
  join public.households h on h.id = t.household_id
  left join public.scheduling_periods p on p.id = t.period_id
  join public.research_consents c on c.member_id = t.member_id and c.withdrawn_at is null;

-- =============================================================================
-- Write functions. All are SECURITY DEFINER with an empty search_path and
-- check the caller before doing anything.
-- =============================================================================

-- ---- Households and members -------------------------------------------------
create function public.create_household(p_name text, p_display_name text, p_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'PamojaHome: sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'PamojaHome: unknown time zone %', p_timezone;
  end if;
  insert into public.households (name, timezone) values (p_name, p_timezone) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name, role)
  values (hid, auth.uid(), p_display_name, 'organizer');
  return hid;                                                               -- US-02
end $$;

create function public.create_invite(p_household uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_organizer(p_household);
        alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    c := substr(c, 1, 4) || '-' || substr(c, 5, 4);
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (household_id, code, created_by) values (p_household, c, me);
  return c;                                                                 -- US-03
end $$;

create function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  select * into inv from public.invites where code = upper(p_code);
  if not found then raise exception 'PamojaHome: invite not found'; end if;
  perform private.require_organizer(inv.household_id);
  update public.invites set revoked_at = now() where id = inv.id and revoked_at is null;
end $$;

create function public.join_household(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invites; existing public.household_members; n int;
begin
  if auth.uid() is null then raise exception 'PamojaHome: sign in first' using errcode = '42501'; end if;
  select * into inv from public.invites where code = upper(btrim(p_code)) for update;
  if not found or inv.revoked_at is not null or inv.expires_at < now() then
    raise exception 'PamojaHome: this invite is invalid or has expired' using errcode = '22023';
  end if;
  select * into existing from public.household_members
   where household_id = inv.household_id and user_id = auth.uid();
  if existing.id is not null and existing.status <> 'archived' then return inv.household_id; end if;
  select count(*) into n from public.household_members
   where household_id = inv.household_id and status <> 'archived';
  if n >= 10 then raise exception 'PamojaHome: households are limited to 10 members (RC-15)'; end if;
  if existing.id is not null then                                           -- rejoining
    update public.household_members
       set status = 'active', archived_at = null, move_out_on = null, display_name = p_display_name
     where id = existing.id;
  else
    insert into public.household_members (household_id, user_id, display_name, rotation_position)
    values (inv.household_id, auth.uid(), p_display_name, n);
  end if;
  return inv.household_id;
end $$;

create function public.start_move_out(p_member uuid, p_move_out_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.household_members; me uuid;
begin
  select * into m from public.household_members where id = p_member;
  if not found then raise exception 'PamojaHome: member not found'; end if;
  me := private.require_member(m.household_id);
  if me <> m.id and not private.is_organizer(m.household_id) then
    raise exception 'PamojaHome: only the member or the organizer can do this' using errcode = '42501';
  end if;
  update public.household_members set status = 'moving_out', move_out_on = p_move_out_on
   where id = p_member and status <> 'archived';
  -- Open chores after the move-out date are cancelled and re-shared by the next allocation (US-29).
  with c as (
    update public.tasks set status = 'cancelled'
     where member_id = p_member and status = 'assigned' and due_on > p_move_out_on
    returning household_id, id)
  insert into public.task_events (household_id, task_id, actor_member_id, action)
  select household_id, id, me, 'cancelled' from c;
end $$;

-- Archive = remove from the household. Allowed only at a zero balance (RC-25);
-- the member row and all history stay (RC-14). Used by US-04 and US-29.
create function public.archive_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.household_members; me uuid; bal bigint; organizers int;
begin
  select * into m from public.household_members where id = p_member for update;
  if not found or m.status = 'archived' then raise exception 'PamojaHome: member not found'; end if;
  me := private.require_member(m.household_id);
  if me <> m.id and not private.is_organizer(m.household_id) then
    raise exception 'PamojaHome: only the member or the organizer can do this' using errcode = '42501';
  end if;
  select balance_cents into bal from public.member_balances where member_id = p_member;
  if coalesce(bal, 0) <> 0 then
    raise exception 'PamojaHome: settle the balance (% cents) before archiving', bal using errcode = '23514';
  end if;
  if m.role = 'organizer' then
    select count(*) into organizers from public.household_members
     where household_id = m.household_id and role = 'organizer' and status <> 'archived' and id <> m.id;
    if organizers = 0 then
      raise exception 'PamojaHome: make another member organizer first';
    end if;
  end if;
  update public.tasks set status = 'cancelled' where member_id = p_member and status = 'assigned';
  update public.household_members set status = 'archived', archived_at = now() where id = p_member;
end $$;

create function public.set_member_role(p_member uuid, p_role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  select household_id into hid from public.household_members where id = p_member and status <> 'archived';
  if hid is null then raise exception 'PamojaHome: member not found'; end if;
  perform private.require_organizer(hid);
  if p_role = 'member' and (select count(*) from public.household_members
                             where household_id = hid and role = 'organizer' and status <> 'archived') <= 1
     and (select role from public.household_members where id = p_member) = 'organizer' then
    raise exception 'PamojaHome: a household needs at least one organizer';
  end if;
  update public.household_members set role = p_role where id = p_member;
end $$;

create function public.update_household(p_household uuid, p_name text, p_timezone text,
                                        p_allocation_mode public.allocation_mode) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_organizer(p_household);                          -- RC-02, US-06
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'PamojaHome: unknown time zone %', p_timezone;
  end if;
  update public.households
     set name = p_name, timezone = p_timezone, allocation_mode = p_allocation_mode
   where id = p_household;
end $$;

-- ---- Chores, votes, preferences ----------------------------------------------
create function public.upsert_chore(p_household uuid, p_chore uuid, p_name text,
                                    p_frequency public.chore_frequency, p_effort smallint,
                                    p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  perform private.require_organizer(p_household);                          -- US-05
  if p_chore is null then
    if (select count(*) from public.chores where household_id = p_household and active) >= 50 then
      raise exception 'PamojaHome: households are limited to 50 chores (RC-15)';
    end if;
    insert into public.chores (household_id, name, frequency, organizer_effort, effort)
    values (p_household, p_name, p_frequency, p_effort, p_effort) returning id into cid;
  else
    update public.chores
       set name = p_name, frequency = p_frequency, organizer_effort = p_effort, active = p_active
     where id = p_chore and household_id = p_household returning id into cid;
    if cid is null then raise exception 'PamojaHome: chore not found'; end if;
    perform private.recompute_chore_effort(cid);
  end if;
  return cid;
end $$;

create function public.cast_effort_vote(p_chore uuid, p_effort smallint) returns smallint
language plpgsql security definer set search_path = '' as $$
declare hid uuid; me uuid; eff smallint;
begin
  select household_id into hid from public.chores where id = p_chore and active;
  if hid is null then raise exception 'PamojaHome: chore not found'; end if;
  me := private.require_member(hid);
  insert into public.effort_votes (chore_id, household_id, member_id, effort)
  values (p_chore, hid, me, p_effort)
  on conflict (chore_id, member_id) do update set effort = excluded.effort, updated_at = now();
  select effort into eff from public.chores where id = p_chore;
  return eff;                                                              -- new household value
end $$;

-- Vote counts without revealing who voted what (US-30).
create function public.effort_vote_counts(p_household uuid)
returns table (chore_id uuid, votes integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_household);
  return query select v.chore_id, count(*)::int from public.effort_votes v
                where v.household_id = p_household group by v.chore_id;
end $$;

create function public.set_chore_preference(p_chore uuid, p_preference public.preference_level) returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid; me uuid;
begin
  select household_id into hid from public.chores where id = p_chore;
  if hid is null then raise exception 'PamojaHome: chore not found'; end if;
  me := private.require_member(hid);                                       -- US-07
  insert into public.chore_preferences (chore_id, household_id, member_id, preference)
  values (p_chore, hid, me, p_preference)
  on conflict (chore_id, member_id) do update set preference = excluded.preference, updated_at = now();
end $$;

-- ---- Tasks: complete, confirm, dispute, swap ---------------------------------
create function private.log_task_event(t public.tasks, actor uuid, act public.task_action, note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_events (household_id, task_id, actor_member_id, action, note)
  values (t.household_id, t.id, actor, act, note)
$$;

create function public.mark_task_done(p_task uuid, p_minutes integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; me uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_member(t.household_id);
  if t.member_id <> me then
    raise exception 'PamojaHome: only the assignee can mark this done' using errcode = '42501';  -- US-11
  end if;
  if t.status <> 'assigned' then raise exception 'PamojaHome: task is %', t.status; end if;
  update public.tasks set status = 'pending_confirmation', completed_at = now(),
                          reported_minutes = p_minutes where id = p_task;
  perform private.log_task_event(t, me, 'marked_done');
end $$;

create function public.undo_task_done(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; me uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_member(t.household_id);
  if t.member_id <> me or t.status <> 'pending_confirmation' or t.kind <> 'scheduled' then
    raise exception 'PamojaHome: cannot undo this task' using errcode = '42501';
  end if;
  update public.tasks set status = 'assigned', completed_at = null, reported_minutes = null where id = p_task;
  perform private.log_task_event(t, me, 'undone');
end $$;

create function public.log_one_off_task(p_household uuid, p_title text, p_effort smallint,
                                        p_minutes integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household); t public.tasks;
begin
  insert into public.tasks (household_id, kind, title, member_id, effort, status, completed_at,
                            reported_minutes, due_on)
  values (p_household, 'one_off', p_title, me, p_effort, 'pending_confirmation', now(),
          p_minutes, private.household_today(p_household))
  returning * into t;                                                      -- US-28
  perform private.log_task_event(t, me, 'marked_done');
  return t.id;
end $$;

create function public.confirm_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; me uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_member(t.household_id);
  if t.member_id = me then
    raise exception 'PamojaHome: you cannot confirm your own task' using errcode = '42501';  -- US-12
  end if;
  if t.status <> 'pending_confirmation' then raise exception 'PamojaHome: task is %', t.status; end if;
  update public.tasks set status = 'confirmed', confirmed_at = now() where id = p_task;
  perform private.log_task_event(t, me, 'confirmed');
end $$;

create function public.dispute_task(p_task uuid, p_note text) returns public.task_status
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; me uuid; next_status public.task_status;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_member(t.household_id);
  if t.member_id = me then raise exception 'PamojaHome: you cannot dispute your own task' using errcode = '42501'; end if;
  if t.status <> 'pending_confirmation' then raise exception 'PamojaHome: task is %', t.status; end if;
  -- First dispute returns the chore to Assigned (US-12); a second one escalates (US-33).
  next_status := case when t.dispute_count >= 1 then 'escalated' else 'assigned' end;
  update public.tasks
     set status = next_status, dispute_count = dispute_count + 1,
         completed_at = case when next_status = 'assigned' then null else completed_at end
   where id = p_task;
  perform private.log_task_event(t, me, 'disputed', p_note);
  if next_status = 'escalated' then perform private.log_task_event(t, null, 'escalated'); end if;
  return next_status;
end $$;

create function public.resolve_dispute(p_task uuid, p_done boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; me uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_organizer(t.household_id);                        -- US-33
  if t.status <> 'escalated' then raise exception 'PamojaHome: task is not escalated'; end if;
  if p_done then
    update public.tasks set status = 'confirmed', confirmed_at = now() where id = p_task;
    perform private.log_task_event(t, me, 'resolved_done', p_note);
  else
    update public.tasks set status = 'assigned', completed_at = null where id = p_task;
    perform private.log_task_event(t, me, 'resolved_not_done', p_note);
  end if;
end $$;

create function public.request_swap(p_task uuid, p_target_member uuid, p_target_task uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tasks; tt public.tasks; me uuid; sid uuid;
begin
  select * into t from public.tasks where id = p_task;
  if not found then raise exception 'PamojaHome: task not found'; end if;
  me := private.require_member(t.household_id);
  if t.member_id <> me or t.status <> 'assigned' or t.kind <> 'scheduled' then
    raise exception 'PamojaHome: you can only offer your own open chores' using errcode = '42501';
  end if;
  if not exists (select 1 from public.household_members where id = p_target_member
                  and household_id = t.household_id and status = 'active') then
    raise exception 'PamojaHome: that housemate cannot take swaps';
  end if;
  if p_target_task is not null then
    select * into tt from public.tasks where id = p_target_task;
    if not found or tt.household_id <> t.household_id or tt.member_id <> p_target_member
       or tt.status <> 'assigned' then
      raise exception 'PamojaHome: the chore offered in exchange is not available';
    end if;
  end if;
  insert into public.swap_requests (household_id, task_id, requester_id, target_member_id, target_task_id)
  values (t.household_id, p_task, me, p_target_member, p_target_task) returning id into sid;
  return sid;                                                              -- US-13
end $$;

create function public.respond_swap(p_swap uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.swap_requests; me uuid; t public.tasks; tt public.tasks;
begin
  select * into s from public.swap_requests where id = p_swap for update;
  if not found then raise exception 'PamojaHome: swap request not found'; end if;
  me := private.require_member(s.household_id);
  if s.status <> 'pending' then raise exception 'PamojaHome: swap is %', s.status; end if;
  if me = s.requester_id and not p_accept then
    update public.swap_requests set status = 'cancelled', responded_at = now() where id = p_swap;
    return;
  end if;
  if me <> s.target_member_id then
    raise exception 'PamojaHome: only the person asked can answer' using errcode = '42501';
  end if;
  if not p_accept then
    update public.swap_requests set status = 'declined', responded_at = now() where id = p_swap;
    return;                                                                -- assignments unchanged
  end if;
  select * into t from public.tasks where id = s.task_id for update;
  if t.status <> 'assigned' or t.member_id <> s.requester_id then
    raise exception 'PamojaHome: this chore is no longer available to swap';
  end if;
  update public.tasks set member_id = s.target_member_id where id = t.id;
  perform private.log_task_event(t, me, 'reassigned');
  if s.target_task_id is not null then
    select * into tt from public.tasks where id = s.target_task_id for update;
    if tt.status <> 'assigned' or tt.member_id <> s.target_member_id then
      raise exception 'PamojaHome: the chore offered in exchange is no longer available';
    end if;
    update public.tasks set member_id = s.requester_id where id = tt.id;
    perform private.log_task_event(tt, me, 'reassigned');
  end if;
  update public.swap_requests set status = 'accepted', responded_at = now() where id = p_swap;
end $$;

-- ---- Money ---------------------------------------------------------------------
-- Internal: writes one balanced expense. Equal splits share among current
-- members and give leftover cents to the payer (RC-09, OQ-06). Idempotent (RC-16).
create function private.insert_expense(
  p_household uuid, p_description text, p_amount_cents bigint, p_paid_by uuid,
  p_split public.split_method, p_shares jsonb, p_idempotency_key uuid, p_spent_on date,
  p_source public.expense_source, p_created_by uuid,
  p_recurring_expense uuid default null, p_receipt uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare eid uuid; n int; base bigint; remainder bigint; total bigint;
begin
  select id into eid from public.expenses
   where household_id = p_household and idempotency_key = p_idempotency_key;
  if found then return eid; end if;
  if not exists (select 1 from public.household_members where id = p_paid_by
                  and household_id = p_household and status <> 'archived') then
    raise exception 'PamojaHome: the payer must be a current member';
  end if;
  insert into public.expenses (household_id, description, amount_cents, paid_by, split_method, source,
                               recurring_expense_id, receipt_id, spent_on, created_by, idempotency_key)
  values (p_household, p_description, p_amount_cents, p_paid_by, p_split, p_source,
          p_recurring_expense, p_receipt, coalesce(p_spent_on, private.household_today(p_household)),
          p_created_by, p_idempotency_key)
  returning id into eid;

  if p_split = 'equal' then
    select count(*) into n from public.household_members
     where household_id = p_household and status <> 'archived';
    base := p_amount_cents / n;
    remainder := p_amount_cents - base * n;
    insert into public.expense_shares (expense_id, household_id, member_id, share_cents)
    select eid, p_household, m.id, base + case when m.id = p_paid_by then remainder else 0 end
      from public.household_members m
     where m.household_id = p_household and m.status <> 'archived';
  else
    if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
      raise exception 'PamojaHome: custom splits need a list of shares';
    end if;
    select coalesce(sum((x ->> 'share_cents')::bigint), 0) into total
      from jsonb_array_elements(p_shares) x;
    if total <> p_amount_cents then
      raise exception 'PamojaHome: shares add up to % cents but the total is % cents', total, p_amount_cents
        using errcode = '23514';                                           -- US-15
    end if;
    insert into public.expense_shares (expense_id, household_id, member_id, share_cents)
    select eid, p_household, (x ->> 'member_id')::uuid, sum((x ->> 'share_cents')::bigint)
      from jsonb_array_elements(p_shares) x
     group by (x ->> 'member_id')::uuid;
  end if;
  return eid;
exception when unique_violation then
  -- A concurrent retry with the same key won the race: return its row.
  select id into eid from public.expenses
   where household_id = p_household and idempotency_key = p_idempotency_key;
  if eid is null then raise; end if;
  return eid;
end $$;

create function public.record_expense(
  p_household uuid, p_description text, p_amount_cents bigint, p_paid_by uuid,
  p_split public.split_method, p_shares jsonb, p_idempotency_key uuid, p_spent_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household);
begin
  if p_split = 'itemized' then
    raise exception 'PamojaHome: itemized splits come from confirm_receipt';
  end if;
  return private.insert_expense(p_household, p_description, p_amount_cents, p_paid_by, p_split,
                                p_shares, p_idempotency_key, p_spent_on, 'manual', me);
end $$;

create function public.record_payment(p_household uuid, p_from uuid, p_to uuid, p_amount_cents bigint,
                                      p_idempotency_key uuid, p_paid_on date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household); pid uuid;
begin
  if me not in (p_from, p_to) and not private.is_organizer(p_household) then
    raise exception 'PamojaHome: record payments you made or received' using errcode = '42501';  -- US-18
  end if;
  select id into pid from public.payments where household_id = p_household and idempotency_key = p_idempotency_key;
  if found then return pid; end if;
  insert into public.payments (household_id, from_member_id, to_member_id, amount_cents, paid_on,
                               created_by, idempotency_key)
  values (p_household, p_from, p_to, p_amount_cents,
          coalesce(p_paid_on, private.household_today(p_household)), me, p_idempotency_key)
  returning id into pid;
  return pid;
exception when unique_violation then
  select id into pid from public.payments where household_id = p_household and idempotency_key = p_idempotency_key;
  if pid is null then raise; end if;
  return pid;
end $$;

-- Reverse an expense, payment or chore credit (US-19). Allowed for whoever
-- created it, the payer, or an organizer.
create function public.reverse_entry(p_kind text, p_entry uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid; creator uuid; payer uuid; me uuid; rid uuid;
begin
  if p_kind = 'expense' then
    select household_id, created_by, paid_by into hid, creator, payer from public.expenses where id = p_entry;
  elsif p_kind = 'payment' then
    select household_id, created_by, from_member_id into hid, creator, payer from public.payments where id = p_entry;
  elsif p_kind = 'credit' then
    select household_id, earner_id, earner_id into hid, creator, payer from public.chore_credits where id = p_entry;
  else
    raise exception 'PamojaHome: kind must be expense, payment or credit';
  end if;
  if hid is null then raise exception 'PamojaHome: entry not found'; end if;
  me := private.require_member(hid);
  if me not in (creator, payer) and not private.is_organizer(hid) then
    raise exception 'PamojaHome: only the person who recorded it, the payer, or an organizer can reverse this'
      using errcode = '42501';
  end if;
  insert into public.reversals (household_id, expense_id, payment_id, credit_id, reason, created_by)
  values (hid,
          case when p_kind = 'expense' then p_entry end,
          case when p_kind = 'payment' then p_entry end,
          case when p_kind = 'credit'  then p_entry end,
          p_reason, me)
  returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'PamojaHome: this entry has already been reversed' using errcode = '23505';
end $$;

-- Greedy settle-up (US-17, DD-08): largest debtor pays largest creditor until
-- everyone is at zero. At most (members with a balance − 1) payments.
create function public.settle_up_suggestions(p_household uuid)
returns table (from_member_id uuid, to_member_id uuid, amount_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare ids uuid[]; bals bigint[]; d int; c int; amt bigint; i int;
begin
  perform private.require_member(p_household);
  select array_agg(b.member_id order by b.member_id), array_agg(b.balance_cents order by b.member_id)
    into ids, bals
    from public.member_balances b
   where b.household_id = p_household and b.balance_cents <> 0;
  if ids is null then return; end if;
  loop
    d := null; c := null;
    for i in 1 .. array_length(ids, 1) loop
      if bals[i] < 0 and (d is null or bals[i] < bals[d]) then d := i; end if;
      if bals[i] > 0 and (c is null or bals[i] > bals[c]) then c := i; end if;
    end loop;
    exit when d is null or c is null;
    amt := least(-bals[d], bals[c]);
    from_member_id := ids[d]; to_member_id := ids[c]; amount_cents := amt;
    return next;
    bals[d] := bals[d] + amt; bals[c] := bals[c] - amt;
  end loop;
end $$;

-- ---- Recurring bills (US-27, RC-20, DD-10) -------------------------------------
create function public.upsert_recurring_expense(p_household uuid, p_id uuid, p_name text,
                                                p_amount_cents bigint, p_paid_by uuid,
                                                p_day_of_month smallint, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_organizer(p_household); rid uuid;
begin
  if p_id is null then
    insert into public.recurring_expenses (household_id, name, amount_cents, paid_by, day_of_month, created_by)
    values (p_household, p_name, p_amount_cents, p_paid_by, p_day_of_month, me) returning id into rid;
  else
    update public.recurring_expenses                                       -- future cycles only
       set name = p_name, amount_cents = p_amount_cents, paid_by = p_paid_by,
           day_of_month = p_day_of_month, active = p_active
     where id = p_id and household_id = p_household returning id into rid;
    if rid is null then raise exception 'PamojaHome: recurring bill not found'; end if;
  end if;
  return rid;
end $$;

-- ---- Receipts (US-36, RC-22, DD-13) ------------------------------------------
create function public.confirm_receipt(p_receipt uuid, p_description text, p_paid_by uuid,
                                       p_shares jsonb, p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.receipts; me uuid; eid uuid;
begin
  select * into r from public.receipts where id = p_receipt for update;
  if not found then raise exception 'PamojaHome: receipt not found'; end if;
  me := private.require_member(r.household_id);
  if r.status <> 'draft' or r.total_cents is null then
    raise exception 'PamojaHome: this receipt is not a draft';
  end if;
  eid := private.insert_expense(r.household_id, p_description, r.total_cents, p_paid_by, 'itemized',
                                p_shares, p_idempotency_key, null, 'receipt', me, null, r.id);
  update public.receipts set status = 'confirmed', expense_id = eid where id = r.id;
  return eid;
end $$;

-- ---- Chore credit (US-35, RC-23, DD-12) ----------------------------------------
create function public.give_credit_consent(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household);
begin
  insert into public.credit_consents (household_id, member_id) values (p_household, me)
  on conflict do nothing;
end $$;

create function public.withdraw_credit_consent(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household);
begin
  delete from public.credit_consents where household_id = p_household and member_id = me;
  update public.households set chore_credit_enabled = false where id = p_household;  -- unanimity lost
end $$;

create function public.set_chore_credit(p_household uuid, p_enabled boolean, p_rate_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
declare missing int;
begin
  perform private.require_organizer(p_household);
  if p_enabled then
    select count(*) into missing from public.household_members m
     where m.household_id = p_household and m.status <> 'archived'
       and not exists (select 1 from public.credit_consents c where c.member_id = m.id);
    if missing > 0 then
      raise exception 'PamojaHome: % member(s) have not agreed to chore credit yet', missing;
    end if;
  end if;
  update public.households
     set chore_credit_enabled = p_enabled, chore_credit_rate_cents = coalesce(p_rate_cents, chore_credit_rate_cents)
   where id = p_household;
end $$;

-- Extra effort = confirmed points in the month minus the fair share (household
-- total ÷ members), minus points already converted. The credit is paid by the
-- members below their fair share, in proportion to how far below they are;
-- leftover cents go to the one furthest below.
create function private.month_points(p_household uuid, p_start date, p_end date)
returns table (member_id uuid, points numeric)
language sql stable security definer set search_path = '' as $$
  select m.id,
         coalesce(sum(t.effort) filter (where t.status = 'confirmed'
                  and (t.confirmed_at at time zone h.timezone)::date >= p_start
                  and (t.confirmed_at at time zone h.timezone)::date <  p_end), 0)::numeric
    from public.household_members m
    join public.households h on h.id = m.household_id
    left join public.tasks t on t.member_id = m.id
   where m.household_id = p_household and m.status <> 'archived'
   group by m.id
$$;

create function public.use_chore_credit(p_household uuid, p_points integer, p_month date,
                                        p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(p_household); h public.households; m_start date; m_end date;
        fair numeric; mine numeric; used int; cid uuid; amount bigint; short_total numeric; top uuid;
begin
  select * into h from public.households where id = p_household;
  if not h.chore_credit_enabled then
    raise exception 'PamojaHome: chore credit is turned off for this household' using errcode = '42501';
  end if;
  select id into cid from public.chore_credits where household_id = p_household and idempotency_key = p_idempotency_key;
  if found then return cid; end if;
  m_start := date_trunc('month', p_month)::date;
  m_end := (m_start + interval '1 month')::date;

  select avg(points) into fair from private.month_points(p_household, m_start, m_end);
  select points into mine from private.month_points(p_household, m_start, m_end) where member_id = me;
  select coalesce(sum(points), 0) into used from public.chore_credits c
   where c.earner_id = me and c.period_month = m_start
     and not exists (select 1 from public.reversals r where r.credit_id = c.id);
  if p_points > floor(mine - fair) - used then
    raise exception 'PamojaHome: you have % extra points available', greatest(floor(mine - fair) - used, 0)::int;
  end if;

  select sum(fair - points) into short_total from private.month_points(p_household, m_start, m_end) where points < fair;
  if short_total is null or short_total = 0 then
    raise exception 'PamojaHome: no one is below their fair share this month';
  end if;
  select member_id into top from private.month_points(p_household, m_start, m_end)
   where points < fair order by points asc, member_id asc limit 1;

  insert into public.chore_credits (household_id, earner_id, period_month, points, rate_cents, idempotency_key)
  values (p_household, me, m_start, p_points, h.chore_credit_rate_cents, p_idempotency_key)
  returning id, amount_cents into cid, amount;

  with s as (
    select member_id, floor(amount * (fair - points) / short_total)::bigint as share
      from private.month_points(p_household, m_start, m_end) where points < fair
  ), r as (select amount - sum(share) as rest from s)
  insert into public.chore_credit_shares (credit_id, household_id, member_id, amount_cents)
  select cid, p_household, s.member_id, s.share + case when s.member_id = top then r.rest else 0 end
    from s, r;
  return cid;
exception when unique_violation then
  select id into cid from public.chore_credits where household_id = p_household and idempotency_key = p_idempotency_key;
  if cid is null then raise; end if;
  return cid;
end $$;

-- ---- Scheduled work (called by Supabase Cron, DD-16) ---------------------------
-- 48-hour auto-confirmation (US-12, DD-07).
create function public.auto_confirm_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with c as (
    update public.tasks set status = 'confirmed', confirmed_at = now()
     where status = 'pending_confirmation' and completed_at <= now() - interval '48 hours'
    returning household_id, id)
  insert into public.task_events (household_id, task_id, action)
  select household_id, id, 'auto_confirmed' from c;
  get diagnostics n = row_count;
  return n;
end $$;

-- Chores still open after their period ends become Missed, which feeds
-- rebalancing in the next allocation (US-14).
create function public.mark_missed_tasks() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with c as (
    update public.tasks t set status = 'missed'
      from public.scheduling_periods p, public.households h
     where t.period_id = p.id and h.id = t.household_id
       and t.status = 'assigned' and p.ends_on < (now() at time zone h.timezone)::date
    returning t.household_id, t.id)
  insert into public.task_events (household_id, task_id, action)
  select household_id, id, 'missed' from c;
  get diagnostics n = row_count;
  return n;
end $$;

-- Creates each recurring bill exactly once per cycle (RC-20). The expense key is
-- derived from the template and date, so a retried run creates nothing new.
create function public.run_recurring_expenses(p_on date default current_date) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_expenses; eid uuid; n int := 0; inserted int;
begin
  for r in select * from public.recurring_expenses
            where active and day_of_month = extract(day from p_on)
  loop
    eid := private.insert_expense(r.household_id, r.name, r.amount_cents, r.paid_by, 'equal', null,
                                  md5(r.id::text || p_on::text)::uuid, p_on, 'recurring',
                                  r.created_by, r.id, null);
    insert into public.recurring_runs (recurring_expense_id, household_id, cycle_on, expense_id)
    values (r.id, r.household_id, p_on, eid) on conflict do nothing;
    get diagnostics inserted = row_count;
    n := n + inserted;
  end loop;
  return n;
end $$;

-- Deletes receipt drafts and candidate profiles past their retention date
-- (RC-07, RC-22). Storage objects are removed by the server using the paths returned.
create function public.purge_expired_data() returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  return query
    delete from public.receipts where delete_after < now() and status <> 'confirmed'
    returning storage_path;
  delete from public.candidate_invites where delete_after < now();
end $$;
