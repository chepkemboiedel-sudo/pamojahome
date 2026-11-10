-- Missed chores count at partial weight toward workload (DD-05, revised 2026-11-10).
-- Simulation result: weighting a missed chore at ½ beat basic rotation on every
-- measure in all four scenarios, while weights 0 and 1 each traded one kind of
-- fairness for another. The weight is a household setting so the user study can vary it.

alter table public.households
  add column missed_weight_pct smallint not null default 50
    check (missed_weight_pct between 0 and 100);
comment on column public.households.missed_weight_pct is
  'Share of a missed chore''s effort that counts toward the assignee''s load (DD-05). 50 = half.';

-- Record the weight each period was allocated with, so research results can be reproduced (RC-06).
alter table public.scheduling_periods
  add column missed_weight_pct smallint check (missed_weight_pct between 0 and 100);

-- New columns go at the end so existing grants and app queries keep working.
create or replace view public.member_workload with (security_invoker = true) as
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
                                                                     as open_points,
       coalesce((select sum(t.effort) from public.tasks t
                  where t.member_id = m.id and t.status = 'missed'), 0) as missed_points,
       -- The load the allocation engine balances: confirmed + adjustments + weighted missed.
       (coalesce((select sum(t.effort) from public.tasks t
                   where t.member_id = m.id and t.status = 'confirmed'), 0)
      + coalesce((select sum(a.points) from public.workload_adjustments a
                   where a.member_id = m.id), 0)
      + coalesce((select sum(t.effort) from public.tasks t
                   where t.member_id = m.id and t.status = 'missed'), 0)
        * h.missed_weight_pct / 100.0)::numeric(12, 2)               as load_points
  from public.household_members m
  join public.households h on h.id = m.household_id
 where m.status <> 'archived';
comment on view public.member_workload is
  'Per member: confirmed effort, open and missed effort, and load_points, the load the allocation engine balances (US-20, DD-05).';

create function public.set_missed_chore_weight(p_household uuid, p_weight_pct smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_organizer(p_household);                          -- RC-02
  if p_weight_pct is null or p_weight_pct not between 0 and 100 then
    raise exception 'PamojaHome: the missed-chore weight must be between 0 and 100 percent';
  end if;
  update public.households set missed_weight_pct = p_weight_pct where id = p_household;
end $$;

revoke all on function public.set_missed_chore_weight(uuid, smallint) from public, anon;
grant execute on function public.set_missed_chore_weight(uuid, smallint) to authenticated;
