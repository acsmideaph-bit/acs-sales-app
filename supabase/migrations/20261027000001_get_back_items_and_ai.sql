-- Get-back items become tracked commitments, and the account gets AI-assisted
-- priorities and development advice (Ronald, Oct 27, 2026).
--
-- Why:
--   * A get-back item is a promise the customer confirmed in the minutes. As
--     free text inside the FCR nobody owned it after the visit: only the first
--     line resurfaced, nothing could be marked done, and an empty box on the
--     next visit made older promises disappear.
--   * Each item is now a row with a due date and a status. Rows are created
--     when the FCR is APPROVED (the official record; the same rule the
--     suggestions already used), and both the KAM and the RSM may close them.
--   * AI output (Gemini, free tier) is cached per account so the free daily
--     quota is spent once per account per day, not on every page view. Only
--     the account-insights Edge Function (service role) writes the cache.

-- ---------------------------------------------------------------------------
-- 1. Get-back items
-- ---------------------------------------------------------------------------

create table if not exists public.get_back_items (
  id           uuid primary key default gen_random_uuid(),
  fcr_id       uuid not null references public.fcrs(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  owner_id     uuid not null references public.user_profiles(id) on delete cascade,  -- the KAM who promised
  line_no      integer not null,
  item         text not null,
  due_date     date,              -- null on FCRs filed before due dates existed
  promised_on  date not null,     -- the visit date
  status       text not null default 'open' check (status in ('open','done','dropped')),
  closed_by    uuid references public.user_profiles(id) on delete set null,
  closed_at    timestamptz,
  close_note   text,
  created_at   timestamptz not null default now(),
  unique (fcr_id, line_no)
);
create index if not exists get_back_items_account on public.get_back_items (account_id, status);
create index if not exists get_back_items_owner on public.get_back_items (owner_id, status, due_date);

-- A bad date typed into an old form must not break approval.
create or replace function public.safe_date(p text) returns date
language plpgsql immutable set search_path = public as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- Reads get-back items from either FCR shape:
--   new forms: {"rows": [{"item": "...", "due_date": "yyyy-mm-dd"}]}
--   older forms: free text, one item per line (no due date)
create or replace function public.fcr_get_back_list(p_form jsonb)
returns table (line_no integer, item text, due_date date)
language sql immutable set search_path = public as $$
  select r.ord::int, left(trim(r.v ->> 'item'), 1000), public.safe_date(r.v ->> 'due_date')
  from jsonb_array_elements(
         case when jsonb_typeof(p_form -> 'get_back_items' -> 'rows') = 'array'
              then p_form -> 'get_back_items' -> 'rows' else '[]'::jsonb end) with ordinality r(v, ord)
  where coalesce(trim(r.v ->> 'item'), '') <> ''
  union all
  select l.ord::int, left(trim(l.t), 1000), null::date
  from regexp_split_to_table(
         case when jsonb_typeof(p_form -> 'get_back_items') = 'string'
              then p_form ->> 'get_back_items' else '' end, '\n') with ordinality l(t, ord)
  where trim(l.t) <> ''
$$;

-- Approval opens the items. Approved FCRs cannot be edited, so the rows match
-- what the customer confirmed and the RSM approved.
create or replace function public.fcr_open_get_back_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into get_back_items (fcr_id, account_id, owner_id, line_no, item, due_date, promised_on)
    select new.id, new.account_id, new.owner_id, g.line_no, g.item, g.due_date, new.visit_date
    from public.fcr_get_back_list(new.form_data) g
    on conflict (fcr_id, line_no) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists t_fcrs_get_back on public.fcrs;
create trigger t_fcrs_get_back after update of status on public.fcrs
  for each row execute function public.fcr_open_get_back_items();

-- Backfill from FCRs approved before today. FCRs older than 60 days are
-- recorded as already closed so the tracker does not open with stale noise.
insert into public.get_back_items (fcr_id, account_id, owner_id, line_no, item, due_date, promised_on, status, closed_at, close_note)
select f.id, f.account_id, f.owner_id, g.line_no, g.item, g.due_date, f.visit_date,
       case when f.visit_date < current_date - 60 then 'dropped' else 'open' end,
       case when f.visit_date < current_date - 60 then now() end,
       case when f.visit_date < current_date - 60 then 'Closed automatically when tracking started (older than 60 days)' end
from public.fcrs f
cross join lateral public.fcr_get_back_list(f.form_data) g
where f.status = 'approved'
on conflict (fcr_id, line_no) do nothing;

-- Close, drop or reopen an item. Allowed: the KAM who promised it, the
-- account's current KAM (handover), or the direct superior (RSM) of either.
create or replace function public.set_get_back_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g get_back_items%rowtype; acct_kam uuid;
begin
  select * into g from get_back_items where id = p_id for update;
  if not found then raise exception 'Get-back item not found'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  select kam_id into acct_kam from accounts where id = g.account_id;
  if not (g.owner_id = auth.uid()
          or acct_kam = auth.uid()
          or public.is_direct_superior(g.owner_id)
          or (acct_kam is not null and public.is_direct_superior(acct_kam))) then
    raise exception 'Only the KAM or their RSM can update this get-back item';
  end if;
  if p_status not in ('open','done','dropped') then raise exception 'Unknown status %', p_status; end if;
  if p_status = 'dropped' and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why the item is dropped';
  end if;
  update get_back_items set
    status = p_status,
    closed_by = case when p_status = 'open' then null else auth.uid() end,
    closed_at = case when p_status = 'open' then null else now() end,
    close_note = case when p_status = 'open' then null else nullif(left(trim(coalesce(p_note, '')), 1000), '') end
  where id = p_id;
end $$;

alter table public.get_back_items enable row level security;
drop policy if exists get_back_read on public.get_back_items;
-- Whoever may see the KAM (self, superiors, global readers) or the account
-- (the current owner after a handover) sees the promise.
create policy get_back_read on public.get_back_items for select to authenticated
  using (public.my_role() is not null and (
    public.can_view_user(owner_id)
    or exists (select 1 from public.accounts a where a.id = get_back_items.account_id)));
-- No insert/update/delete policies: rows move only through the trigger and RPC.

-- ---------------------------------------------------------------------------
-- 2. AI insights cache and usage log
-- ---------------------------------------------------------------------------

create table if not exists public.account_insights (
  account_id    uuid primary key references public.accounts(id) on delete cascade,
  input_hash    text not null,            -- facts the advice was built from
  source        text not null check (source in ('gemini','rules')),
  model         text,
  payload       jsonb not null,           -- { priorities: [...], develop: { kam: [], rsm: [] } }
  generated_at  timestamptz not null default now(),
  generated_by  uuid references public.user_profiles(id) on delete set null
);

alter table public.account_insights enable row level security;
drop policy if exists insights_read on public.account_insights;
create policy insights_read on public.account_insights for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_insights.account_id));

-- One row per call, so the admin can see quota use and failures.
create table if not exists public.ai_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid,
  account_id     uuid,
  model          text,
  result         text not null check (result in ('ok','cached','fallback','error')),
  error          text,
  input_tokens   integer,
  output_tokens  integer
);
create index if not exists ai_log_created on public.ai_log (created_at desc);
create index if not exists ai_log_user on public.ai_log (user_id, created_at desc);

alter table public.ai_log enable row level security;
drop policy if exists ai_log_read on public.ai_log;
create policy ai_log_read on public.ai_log for select to authenticated
  using (public.is_global_reader() or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Grants: read-only for signed-in users, nothing for the public role
-- ---------------------------------------------------------------------------

revoke all on public.get_back_items, public.account_insights, public.ai_log from anon, authenticated;
grant select on public.get_back_items, public.account_insights, public.ai_log to authenticated;
grant all on public.get_back_items, public.account_insights, public.ai_log to service_role;

revoke execute on function public.safe_date(text) from public, anon;
revoke execute on function public.fcr_get_back_list(jsonb) from public, anon;
revoke execute on function public.fcr_open_get_back_items() from public, anon, authenticated;
revoke execute on function public.set_get_back_status(uuid, text, text) from public, anon;
grant execute on function public.safe_date(text) to authenticated, service_role;
grant execute on function public.fcr_get_back_list(jsonb) to authenticated, service_role;
grant execute on function public.set_get_back_status(uuid, text, text) to authenticated, service_role;
