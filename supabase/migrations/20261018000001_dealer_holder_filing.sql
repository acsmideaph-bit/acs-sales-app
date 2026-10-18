-- Exception: whoever the TTA plan assigns dealers to may file for them.
--
-- Ronald (Oct 18, 2026): Marc Joseph Co (RSM) temporarily handles the dealers
-- the plan assigns to him, until he assigns them to someone on his team. He is
-- an exception to "only KAMs file". Rather than naming him in code, the rule
-- follows the data: a non-KAM who holds dealers in the plan this year can file
-- FCRs and MCP Plans; the visit-month ownership check (check_fcr_account_owner)
-- still limits him to exactly those dealers and months. When the plan moves the
-- dealers to a KAM, the exception ends by itself.
--
-- Approval stays data-driven: his FCRs and plans go to his direct superior
-- (the Channel Head), through review_fcr / review_itinerary unchanged.

-- Holds at least one dealer in the TTA plan this year (Manila time).
create or replace function public.holds_dealers(p_user uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from account_targets
    where kam_id = coalesce(p_user, auth.uid())
      and month >= date_trunc('year', public.manila_month())::date)
$$;

-- Everyone who may file: KAMs, plus dealer holders this year.
create or replace function public.is_filer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_writer() and (public.my_role() = 'kam' or public.holds_dealers(null))
$$;

-- Non-KAM dealer holders, for team reports (names only; RLS on targets still
-- decides who sees which figures).
create or replace function public.dealer_holder_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct kam_id from account_targets
  where kam_id is not null and month >= date_trunc('year', public.manila_month())::date
$$;

drop policy if exists fcrs_insert on public.fcrs;
create policy fcrs_insert on public.fcrs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_filer());

drop policy if exists itin_insert on public.itineraries;
create policy itin_insert on public.itineraries for insert to authenticated
  with check (owner_id = auth.uid() and public.is_filer());

-- A new sub-dealer belongs to whoever holds its dealer this month (KAM or the
-- exception), so the holder can file for it straight away.
create or replace function public.guard_account() returns trigger
language plpgsql set search_path = public as $$
declare parent_kam uuid;
begin
  if public.in_workflow() then return new; end if;

  if tg_op = 'INSERT' then
    if new.account_type <> 'sub_dealer' then
      raise exception 'Dealer accounts come only from the TTA plan upload (by BP code). Add sub-dealers here.';
    end if;
    new.bp_code := null; new.registered_name := null; new.mdm_name := null; new.area := null;
    select t.kam_id into parent_kam
    from accounts d join account_targets t on t.bp_code = d.bp_code and t.month = public.manila_month()
    where d.id = new.parent_dealer_id;
    if parent_kam is not null then new.kam_id := parent_kam;
    elsif public.my_role() = 'kam' then new.kam_id := auth.uid();
    end if;
    return new;
  end if;

  new.bp_code := old.bp_code;
  new.registered_name := old.registered_name;
  new.mdm_name := old.mdm_name;
  new.area := old.area;
  if old.account_type = 'dealer' then
    if not (old.bp_code is null and public.is_admin()) then
      new.account_type := old.account_type;
      new.company_name := old.company_name;
    end if;
    if old.bp_code is not null then new.kam_id := old.kam_id; end if;
  elsif new.account_type <> 'sub_dealer' then
    raise exception 'A sub-dealer cannot be turned into a dealer. Dealers come from the TTA plan upload.';
  end if;
  return new;
end $$;

revoke execute on function public.holds_dealers(uuid) from public, anon;
revoke execute on function public.is_filer() from public, anon;
revoke execute on function public.dealer_holder_ids() from public, anon;
revoke execute on function public.guard_account() from public, anon;
grant execute on function public.holds_dealers(uuid) to authenticated, service_role;
grant execute on function public.is_filer() to authenticated, service_role;
grant execute on function public.dealer_holder_ids() to authenticated, service_role;
