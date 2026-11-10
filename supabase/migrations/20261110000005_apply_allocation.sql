-- Writes one week's allocation in a single transaction (DD-05, RC-11).
-- The weekly job runs the shared engine on the server, then calls this function
-- once per household. A retried run for the same week changes nothing.

-- The engine's reason for each assignment, shown as "Why this is yours" (RC-18).
alter table public.tasks
  add column allocation_reason text
    check (allocation_reason in ('lowest_load', 'preference', 'tie_break', 'fallback_unavailable', 'rotation'));

create function public.apply_allocation(
  p_household uuid, p_starts_on date, p_mode public.allocation_mode, p_missed_weight_pct smallint,
  p_tasks jsonb, p_adjustments jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid; t public.tasks; item jsonb;
begin
  if extract(isodow from p_starts_on) <> 1 then
    raise exception 'PamojaHome: a scheduling period starts on a Monday';
  end if;
  insert into public.scheduling_periods (household_id, starts_on, ends_on, allocation_mode, missed_weight_pct)
  values (p_household, p_starts_on, p_starts_on + 6, p_mode, p_missed_weight_pct)
  on conflict (household_id, starts_on) do nothing
  returning id into pid;
  if pid is null then                                                       -- already allocated: idempotent
    select id into pid from public.scheduling_periods where household_id = p_household and starts_on = p_starts_on;
    return pid;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) loop
    insert into public.workload_adjustments (household_id, member_id, points, reason)
    values (p_household, (item ->> 'member_id')::uuid, (item ->> 'points')::integer,
            (item ->> 'reason')::public.adjustment_reason);
  end loop;

  for item in select * from jsonb_array_elements(p_tasks) loop
    insert into public.tasks (household_id, period_id, chore_id, kind, title, member_id, due_on, effort, allocation_reason)
    values (p_household, pid, (item ->> 'chore_id')::uuid, 'scheduled', item ->> 'title',
            (item ->> 'member_id')::uuid, (item ->> 'due_on')::date, (item ->> 'effort')::smallint,
            item ->> 'reason')
    returning * into t;
    if t.due_on not between p_starts_on and p_starts_on + 6 then
      raise exception 'PamojaHome: task due % is outside the period', t.due_on;
    end if;
    perform private.log_task_event(t, null, 'assigned');
  end loop;
  return pid;
end $$;

revoke all on function public.apply_allocation(uuid, date, public.allocation_mode, smallint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_allocation(uuid, date, public.allocation_mode, smallint, jsonb, jsonb)
  to service_role;
