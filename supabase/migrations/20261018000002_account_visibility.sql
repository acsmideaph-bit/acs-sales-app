-- Account visibility follows ownership (Ronald, Oct 18, 2026):
--   * a KAM sees only their own accounts;
--   * an RSM sees only the accounts of the KAMs under them;
--   * Channel Head, Director, admins and viewers see all.
--
-- "Own" = the dealers the TTA plan gives them this month or last month (last
-- month so a late FCR for a visit at month-end can still be filed), their
-- sub-dealers (kam_id), sub-dealers they created, and the accounts on their
-- own FCRs (so their history still opens after a handover). Superiors see the
-- same for everyone below them (is_above). Unassigned (vacant) dealers are
-- visible only to the Channel Head, Director and admins.
--
-- Replaces the open accounts_read policy from init.sql ("readable by all
-- signed-in users"), and narrows can_view_bp (targets and sales) to match.

create or replace function public.can_view_account(p_id uuid, p_kam uuid, p_bp text, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_reader()
      or public.my_role() in ('channel_head','director')
      or p_kam = auth.uid()
      or (p_kam is not null and public.is_above(p_kam))
      or p_created_by = auth.uid()
      or (p_bp is not null and exists (
            select 1 from account_targets t
            where t.bp_code = p_bp and t.kam_id is not null
              and t.month in (public.manila_month(), (public.manila_month() - interval '1 month')::date)
              and (t.kam_id = auth.uid() or public.is_above(t.kam_id))))
      or exists (select 1 from fcrs f
                 where f.account_id = p_id and (f.owner_id = auth.uid() or public.is_above(f.owner_id)))
$$;

drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated
  using (public.my_role() is not null
         -- creator counts for sub-dealers only; dealers come from the plan
         and public.can_view_account(id, kam_id, bp_code, case when account_type = 'sub_dealer' then created_by end));

-- Targets and official sales of a dealer: visible to whoever may see the
-- dealer as above (all twelve months of it, so the FCR shows the whole year).
create or replace function public.can_view_bp(p_bp text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_global_reader()
      or public.my_role() in ('channel_head','director')
      or exists (select 1 from account_targets t
                 where t.bp_code = p_bp and t.kam_id is not null
                   and t.month in (public.manila_month(), (public.manila_month() - interval '1 month')::date)
                   and (t.kam_id = auth.uid() or public.is_above(t.kam_id)))
      or exists (select 1 from accounts a join fcrs f on f.account_id = a.id
                 where a.bp_code = p_bp and (f.owner_id = auth.uid() or public.is_above(f.owner_id)))
$$;

revoke execute on function public.can_view_account(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.can_view_account(uuid, uuid, text, uuid) to authenticated, service_role;
