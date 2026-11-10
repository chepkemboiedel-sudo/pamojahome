-- =============================================================================
-- PamojaHome · Migration 3 of 3 · Permissions, scheduled jobs, receipt storage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table permissions. Supabase grants everything to anon/authenticated by default;
-- we take that back and grant only reads, plus writes to a few personal tables.
-- RLS policies (migration 2) then decide WHICH rows.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables  in schema public to authenticated;
revoke select on public.notification_outbox, public.research_task_export from authenticated;

grant update (display_name)            on public.profiles                 to authenticated;
grant insert, update, delete           on public.absences                 to authenticated;
grant insert, update, delete           on public.notification_preferences to authenticated;
grant insert, update, delete           on public.push_subscriptions       to authenticated;
grant insert, update                   on public.research_consents        to authenticated;

grant all on all tables in schema public to service_role;

-- Future tables start closed too.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Function permissions. Postgres lets PUBLIC execute new functions; revoke that.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public  revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- Policies call these, so signed-in users need them (they reveal only yes/no).
grant usage on schema private to authenticated, service_role;
grant execute on function private.member_id(uuid), private.is_member(uuid),
                         private.is_organizer(uuid), private.shares_household_with(uuid)
  to authenticated;

-- What the app may call as the signed-in user.
grant execute on function
  public.create_household(text, text, text),
  public.create_invite(uuid),
  public.revoke_invite(text),
  public.join_household(text, text),
  public.start_move_out(uuid, date),
  public.archive_member(uuid),
  public.set_member_role(uuid, public.member_role),
  public.update_household(uuid, text, text, public.allocation_mode),
  public.upsert_chore(uuid, uuid, text, public.chore_frequency, smallint, boolean),
  public.cast_effort_vote(uuid, smallint),
  public.effort_vote_counts(uuid),
  public.set_chore_preference(uuid, public.preference_level),
  public.mark_task_done(uuid, integer),
  public.undo_task_done(uuid),
  public.log_one_off_task(uuid, text, smallint, integer),
  public.confirm_task(uuid),
  public.dispute_task(uuid, text),
  public.resolve_dispute(uuid, boolean, text),
  public.request_swap(uuid, uuid, uuid),
  public.respond_swap(uuid, boolean),
  public.record_expense(uuid, text, bigint, uuid, public.split_method, jsonb, uuid, date),
  public.record_payment(uuid, uuid, uuid, bigint, uuid, date),
  public.reverse_entry(text, uuid, text),
  public.settle_up_suggestions(uuid),
  public.upsert_recurring_expense(uuid, uuid, text, bigint, uuid, smallint, boolean),
  public.confirm_receipt(uuid, text, uuid, jsonb, uuid),
  public.give_credit_consent(uuid),
  public.withdraw_credit_consent(uuid),
  public.set_chore_credit(uuid, boolean, integer),
  public.use_chore_credit(uuid, integer, date, uuid)
to authenticated;

-- Server and scheduler only (RC-04, RC-13). The allocation engine on Vercel
-- writes scheduling_periods, tasks and workload_adjustments with the service role.
grant execute on function
  public.auto_confirm_due(),
  public.mark_missed_tasks(),
  public.run_recurring_expenses(date),
  public.purge_expired_data()
to service_role;
grant execute on all functions in schema private to service_role;

-- -----------------------------------------------------------------------------
-- Scheduled jobs (DD-16). Runs only where the pg_cron extension is enabled
-- (Supabase: Integrations → Cron). Times are UTC; household time zones are
-- applied inside the functions.
-- -----------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pamoja-auto-confirm',  '*/5 * * * *', $job$select public.auto_confirm_due()$job$);
    perform cron.schedule('pamoja-missed-tasks',  '15 * * * *',  $job$select public.mark_missed_tasks()$job$);
    perform cron.schedule('pamoja-recurring',     '5 * * * *',   $job$select public.run_recurring_expenses(current_date)$job$);
    -- Jobs that need the allocation engine or a mail/push provider call the app.
    -- Store the URL and secret in Supabase Vault, then enable pg_net and add, e.g.:
    --   select cron.schedule('pamoja-weekly-allocation', '0 * * * 1', $$
    --     select net.http_post(
    --       url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/allocate',
    --       headers := jsonb_build_object('Authorization', 'Bearer ' ||
    --                  (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')))
    --   $$);
    --   Same pattern for /api/cron/notify (every 5 min) and /api/cron/purge (daily).
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Receipt photos (Phase 3, RC-22). Private bucket; objects live at
-- receipts/<household_id>/<receipt_id>.<ext>. Members can upload and view
-- their household's receipts; only the server deletes them.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and (select private.is_member(((storage.foldername(name))[1])::uuid)));

create policy receipts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and (select private.is_member(((storage.foldername(name))[1])::uuid)));
