-- Dealer accounts keyed by SAP BP code, monthly KAM ownership and targets
-- from the TTA plan, and official monthly sales from the final DSR.
--
-- Decided with Ronald (Oct 16, 2026):
-- * The BP code is the record key of a dealer. Account names are for display;
--   targets, ownership and sales all join on bp_code, so a renamed dealer
--   keeps its history.
-- * Ownership is per MONTH. The TTA plan gives each dealer one KAM per month
--   (45 of 122 dealers change hands during 2026). The visit month of an FCR
--   decides who may file it, not today's date.
-- * Dealers are never typed in. They come only from the TTA plan upload
--   (import_target_plan). KAMs add sub-dealers by hand, under a dealer they
--   own this month.
-- * Official sales = "Actual Sales" per BP code from the final DSR of each
--   month (import_sales_actuals), RAC, LC and Window AC lines only: MBT sold to the same
--   BP code is not ACS sales. A re-upload of a month replaces that month.
-- * Sub-dealers follow their parent dealer's monthly owner (recommended in
--   the integration plan, decision 4).
--
-- Every write to these tables goes through the SECURITY DEFINER import
-- functions (admin only). Clients get read policies only.

-- ---------------------------------------------------------------------------
-- Accounts: BP code and the plan's names
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column bp_code          text,
  add column registered_name  text,   -- DEALER'S REGISTERED COMPANY NAME
  add column mdm_name         text,   -- MDM DEALERS NAME
  add column area             text;   -- plan AREA (NCR, NORTH LUZON, SOUTH LUZON, VISMIN)

-- A plain UNIQUE constraint allows many NULLs (sub-dealers, legacy dealers)
-- and can be the target of a foreign key, which a partial index cannot.
alter table public.accounts add constraint accounts_bp_code_key unique (bp_code);
alter table public.accounts add constraint accounts_bp_code_format
  check (bp_code is null or bp_code ~ '^[0-9A-Za-z-]{3,20}$');
alter table public.accounts add constraint accounts_bp_code_dealer_only
  check (bp_code is null or account_type = 'dealer');

-- ---------------------------------------------------------------------------
-- Import log (plan and DSR)
-- ---------------------------------------------------------------------------

create table public.data_imports (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('target_plan','sales_dsr')),
  plan_year       integer,            -- target_plan
  sales_month     date,               -- sales_dsr, 1st of month
  effective_from  date,               -- target_plan: first month replaced
  file_name       text,
  row_count       integer not null default 0,
  account_count   integer not null default 0,
  total_amount    numeric(18,2) not null default 0,
  summary         jsonb not null default '{}'::jsonb,
  reason          text,
  imported_by     uuid references public.user_profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index on public.data_imports (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- KAM names as written in the plan -> roster email
-- ---------------------------------------------------------------------------
-- The plan uses short names ("HADJIE TECSON", "JC NOGUERA"). An explicit map
-- means a typo in the file stops the import instead of silently creating or
-- reassigning an owner. Email (the roster key), not user id, so a KAM who has
-- not signed in yet can already own accounts.

create table public.kam_aliases (
  alias       text primary key check (alias = upper(btrim(regexp_replace(alias, '\s+', ' ', 'g')))),
  status      text not null default 'kam' check (status in ('kam','vacant','not_in_app')),
  email       text,
  note        text,
  updated_at  timestamptz not null default now(),
  constraint kam_alias_email check ((status = 'kam') = (email is not null))
);

-- ---------------------------------------------------------------------------
-- Monthly owner and target per dealer
-- ---------------------------------------------------------------------------

create table public.account_targets (
  bp_code        text not null references public.accounts(bp_code) on update cascade on delete restrict,
  month          date not null check (extract(day from month) = 1),
  kam_label      text not null,      -- the name as written in the plan
  kam_email      text,               -- null = vacant / not in app
  kam_id         uuid references public.user_profiles(id) on delete set null,  -- resolved from kam_email
  target_amount  numeric(16,2) not null default 0 check (target_amount >= 0),
  import_id      uuid references public.data_imports(id) on delete set null,
  primary key (bp_code, month)       -- one owner per dealer per month
);
create index on public.account_targets (kam_id, month);
create index on public.account_targets (month);

-- ---------------------------------------------------------------------------
-- Official monthly sales per BP code (final DSR)
-- ---------------------------------------------------------------------------
-- No foreign key to accounts: the DSR also carries customers outside the
-- ACS plan, and their sales are kept as loaded.

-- RAC + LC + Window AC only (see import_sales_actuals).
create table public.sales_actuals (
  bp_code       text not null,
  month         date not null check (extract(day from month) = 1),
  actual_sales  numeric(16,2) not null,
  line_count    integer not null default 1,
  import_id     uuid references public.data_imports(id) on delete set null,
  primary key (bp_code, month)
);
create index on public.sales_actuals (month);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.manila_month(d date default null) returns date
language sql stable set search_path = public as $$
  select date_trunc('month', coalesce(d, (now() at time zone 'Asia/Manila')::date))::date
$$;

-- Who may see a dealer's targets and sales: anyone who owns it in any month,
-- anyone above such an owner, RSMs for unassigned months, the Channel Head,
-- Director and global readers.
create or replace function public.can_view_bp(p_bp text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_global_reader()
      or public.my_role() in ('channel_head','director')
      or exists (select 1 from account_targets t
                 where t.bp_code = p_bp
                   and (t.kam_id = auth.uid() or (t.kam_id is not null and public.is_above(t.kam_id))))
      or (public.my_role() = 'rsm' and exists (select 1 from account_targets t where t.bp_code = p_bp and t.kam_id is null))
$$;

-- Does the caller own this dealer in the month of p_date?
create or replace function public.owns_dealer(p_account uuid, p_date date default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a join account_targets t on t.bp_code = a.bp_code
    where a.id = p_account and a.account_type = 'dealer'
      and t.month = public.manila_month(p_date) and t.kam_id = auth.uid())
$$;

-- Months of the year for which a final DSR has been loaded. Readable by every
-- signed-in user, so "no sales" can be told apart from "not loaded yet".
create or replace function public.sales_months_loaded(p_year integer)
returns setof date language sql stable security definer set search_path = public as $$
  select distinct sales_month from data_imports
  where kind = 'sales_dsr' and extract(year from sales_month) = p_year
  order by 1
$$;

-- Resolve owners from email and move each dealer's current owner onto
-- accounts.kam_id (existing screens, edit rights and reports read it).
-- Sub-dealers follow their parent dealer. Runs after each plan import and
-- daily at 00:05 Manila, so handovers take effect on the 1st by themselves.
create or replace function public.sync_account_owners() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer; cur date := public.manila_month();
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can run the owner sync';
  end if;
  perform set_config('app.workflow', 'on', true);

  update account_targets t set kam_id = p.id
  from user_profiles p
  where t.kam_email is not null and lower(p.email) = lower(t.kam_email) and t.kam_id is distinct from p.id;
  update account_targets set kam_id = null
  where kam_id is not null and (kam_email is null
        or not exists (select 1 from user_profiles p where p.id = account_targets.kam_id and lower(p.email) = lower(account_targets.kam_email)));

  update accounts a set kam_id = t.kam_id
  from account_targets t
  where t.bp_code = a.bp_code and t.month = cur and a.kam_id is distinct from t.kam_id;
  get diagnostics m = row_count; n := n + m;

  -- A dealer in the plan with no row this month has no owner this month.
  update accounts a set kam_id = null
  where a.bp_code is not null and a.kam_id is not null
    and not exists (select 1 from account_targets t where t.bp_code = a.bp_code and t.month = cur);
  get diagnostics m = row_count; n := n + m;

  update accounts s set kam_id = d.kam_id
  from accounts d
  where s.account_type = 'sub_dealer' and s.parent_dealer_id = d.id
    and d.bp_code is not null and d.kam_id is not null and s.kam_id is distinct from d.kam_id;
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Dealers come only from the plan import. Client writes may create
-- sub-dealers and edit contact details; the dealer's identity (BP code, name,
-- type) and its plan-driven owner do not move outside the import.
create or replace function public.guard_account() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.in_workflow() then return new; end if;

  if tg_op = 'INSERT' then
    if new.account_type <> 'sub_dealer' then
      raise exception 'Dealer accounts come only from the TTA plan upload (by BP code). Add sub-dealers here.';
    end if;
    new.bp_code := null; new.registered_name := null; new.mdm_name := null; new.area := null;
    if public.my_role() = 'kam' then new.kam_id := auth.uid(); end if;
    return new;
  end if;

  new.bp_code := old.bp_code;
  new.registered_name := old.registered_name;
  new.mdm_name := old.mdm_name;
  new.area := old.area;
  if old.account_type = 'dealer' then
    -- An admin may turn a legacy dealer (profiled by hand, no BP code) into a
    -- sub-dealer; nothing else changes a dealer's type or name.
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

create trigger t_accounts_guard before insert or update on public.accounts
  for each row execute function public.guard_account();

-- Who may add a sub-dealer under a given dealer: the dealer's owner this
-- month, anyone above that owner, or an admin.
create or replace function public.can_add_sub_dealer(p_parent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.owns_dealer(p_parent, null)
      or exists (select 1 from accounts d where d.id = p_parent and d.account_type = 'dealer'
                 and d.kam_id is not null and public.is_above(d.kam_id))
$$;

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.is_writer() and account_type = 'sub_dealer'
              and parent_dealer_id is not null and public.can_add_sub_dealer(parent_dealer_id));

-- FCRs: a dealer FCR may be filed only by the dealer's owner in the VISIT
-- month; a sub-dealer FCR only by its assigned KAM. Checked on insert and
-- whenever the account or the visit month changes.
create or replace function public.check_fcr_account_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare a accounts%rowtype;
begin
  if public.in_workflow() then return new; end if;
  if tg_op = 'UPDATE' and new.account_id = old.account_id
     and public.manila_month(new.visit_date) = public.manila_month(old.visit_date) then
    return new;
  end if;
  select * into a from accounts where id = new.account_id;
  if not found then raise exception 'Account not found'; end if;
  if a.account_type = 'dealer' then
    if a.bp_code is null then
      raise exception '% has no BP code yet. Ask the admin to link it to the TTA plan.', a.company_name;
    end if;
    if not exists (select 1 from account_targets t
                   where t.bp_code = a.bp_code and t.month = public.manila_month(new.visit_date)
                     and t.kam_id = new.owner_id) then
      raise exception '% (BP %) is not assigned to you for %.', a.company_name, a.bp_code, to_char(new.visit_date, 'FMMonth YYYY');
    end if;
  elsif a.kam_id is distinct from new.owner_id then
    raise exception 'Sub-dealer % is assigned to another KAM.', a.company_name;
  end if;
  return new;
end $$;

create trigger t_fcrs_owner_check before insert or update of account_id, visit_date on public.fcrs
  for each row execute function public.check_fcr_account_owner();

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

-- TTA plan. p_rows: one element per plan row
--   {bp_code, account, registered_name, mdm_name, area, kam_label, months: [12 values or null]}
-- A month value that is null means "not this KAM's month"; a number (also 0)
-- means this KAM owns the dealer that month with that target.
-- Months from p_effective_from to December are replaced for the whole plan;
-- earlier months are kept unless p_effective_from is January (a restatement,
-- which needs a reason). p_dry_run returns the summary without writing.
create or replace function public.import_target_plan(
  p_year integer, p_rows jsonb, p_file_name text default null,
  p_effective_from date default null, p_reason text default null, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eff date := coalesce(p_effective_from, make_date(p_year, 1, 1));
  cur date := public.manila_month();
  imp uuid;
  res jsonb;
  errors jsonb := '[]'::jsonb;
  n_new int; n_link int; n_upd int; n_rows int; n_accts int; total numeric;
begin
  if not public.is_admin() then raise exception 'Only an admin can load the TTA plan'; end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'Choose the plan year'; end if;
  if extract(year from eff) <> p_year or extract(day from eff) <> 1 then
    raise exception 'The first month replaced must be the 1st of a month in %', p_year;
  end if;
  if eff < cur and eff > make_date(p_year, 1, 1) then
    raise exception 'Replace from the current month onward, or restate the whole year from January';
  end if;
  if eff = make_date(p_year, 1, 1) and make_date(p_year, 1, 1) < cur
     and exists (select 1 from account_targets where extract(year from month) = p_year)
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Restating months already past needs a reason';
  end if;

  -- Flatten: one row per plan line x month that carries a value.
  drop table if exists _plan;
  create temp table _plan on commit drop as
  select btrim(r->>'bp_code') as bp_code,
         btrim(r->>'account') as account,
         nullif(btrim(r->>'registered_name'), '') as registered_name,
         nullif(btrim(r->>'mdm_name'), '') as mdm_name,
         nullif(upper(btrim(r->>'area')), '') as area,
         upper(btrim(regexp_replace(r->>'kam_label', '\s+', ' ', 'g'))) as kam_label,
         make_date(p_year, m.i::int, 1) as month,
         (m.v)::numeric as amount
  from jsonb_array_elements(p_rows) r,
       lateral jsonb_array_elements_text(r->'months') with ordinality as m(v, i)
  where m.v is not null;

  -- Validation
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'bad_bp_code', 'bp_code', bp_code, 'account', account)), '[]')
    into errors from (select distinct bp_code, account from _plan where bp_code is null or bp_code !~ '^[0-9A-Za-z-]{3,20}$') x;
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'negative', 'bp_code', bp_code, 'month', month)), '[]')
    into errors from _plan where amount < 0;
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'unknown_kam', 'kam_label', kam_label)), '[]')
    into errors from (select distinct p.kam_label from _plan p left join kam_aliases k on k.alias = p.kam_label where k.alias is null) x;
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'two_owners', 'bp_code', bp_code, 'month', month, 'kams', kams)), '[]')
    into errors from (select bp_code, month, jsonb_agg(distinct kam_label) kams from _plan group by bp_code, month having count(*) > 1) x;
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'two_names', 'bp_code', bp_code, 'names', names)), '[]')
    into errors from (select bp_code, jsonb_agg(distinct account) names from _plan group by bp_code having count(distinct upper(account)) > 1) x;
  -- Same account name already used by a different BP code in the app.
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'name_taken', 'bp_code', p.bp_code, 'account', p.account, 'other_bp_code', a.bp_code)), '[]')
    into errors from (select distinct bp_code, account from _plan) p
    join accounts a on lower(btrim(a.company_name)) = lower(p.account) and a.account_type = 'dealer'
    where a.bp_code is not null and a.bp_code <> p.bp_code;
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'kam_not_on_roster', 'kam_label', k.alias, 'email', k.email)), '[]')
    into errors from kam_aliases k
    where k.status = 'kam' and k.alias in (select kam_label from _plan)
      and not exists (select 1 from org_roster r where lower(r.email) = lower(k.email));

  select count(*) into n_new from (select distinct bp_code, account from _plan) p
    where not exists (select 1 from accounts a where a.bp_code = p.bp_code)
      and not exists (select 1 from accounts a where a.bp_code is null and a.account_type = 'dealer' and lower(btrim(a.company_name)) = lower(p.account));
  select count(*) into n_link from (select distinct bp_code, account from _plan) p
    where not exists (select 1 from accounts a where a.bp_code = p.bp_code)
      and exists (select 1 from accounts a where a.bp_code is null and a.account_type = 'dealer' and lower(btrim(a.company_name)) = lower(p.account));
  select count(*) into n_upd from (select distinct bp_code from _plan) p where exists (select 1 from accounts a where a.bp_code = p.bp_code);
  select count(*), count(distinct bp_code), coalesce(sum(amount), 0) into n_rows, n_accts, total from _plan where month >= eff;

  res := jsonb_build_object(
    'year', p_year, 'effective_from', eff, 'dealers', n_accts, 'dealer_months', n_rows, 'total', total,
    'new_dealers', n_new, 'linked_existing', n_link, 'updated_dealers', n_upd,
    'kept_months', (select count(*) from account_targets where extract(year from month) = p_year and month < eff),
    'errors', errors,
    -- Not blocking: only KAMs can file FCRs, so dealers owned by anyone else
    -- (an RSM, a vacant slot) get no FCRs in those months.
    'warnings', jsonb_build_object(
      'owner_not_kam', (select coalesce(jsonb_agg(jsonb_build_object('kam_label', x.alias, 'role', x.role, 'dealers', x.n) order by x.alias), '[]')
                        from (select k.alias, r.role, count(distinct p.bp_code) n
                              from _plan p join kam_aliases k on k.alias = p.kam_label
                              join org_roster r on lower(r.email) = lower(k.email)
                              where k.status = 'kam' and r.role <> 'kam' and p.month >= eff
                              group by k.alias, r.role) x),
      'unassigned', (select coalesce(jsonb_agg(jsonb_build_object('kam_label', x.alias, 'status', x.status, 'dealers', x.n) order by x.alias), '[]')
                     from (select k.alias, k.status, count(distinct p.bp_code) n
                           from _plan p join kam_aliases k on k.alias = p.kam_label
                           where k.status <> 'kam' and p.month >= eff group by k.alias, k.status) x)));

  if p_dry_run or jsonb_array_length(errors) > 0 then
    return res || jsonb_build_object('applied', false);
  end if;

  perform set_config('app.workflow', 'on', true);

  insert into data_imports (kind, plan_year, effective_from, file_name, row_count, account_count, total_amount, summary, reason)
  values ('target_plan', p_year, eff, p_file_name, n_rows, n_accts, total, res, nullif(btrim(p_reason), ''))
  returning id into imp;

  -- 1. Link legacy dealers (no BP code) that carry the plan's account name.
  update accounts a set bp_code = p.bp_code
  from (select distinct bp_code, account from _plan) p
  where a.bp_code is null and a.account_type = 'dealer' and lower(btrim(a.company_name)) = lower(p.account)
    and not exists (select 1 from accounts x where x.bp_code = p.bp_code);

  -- 2. Create the rest; refresh names on all.
  insert into accounts (account_type, company_name, bp_code, registered_name, mdm_name, area, created_by)
  select distinct on (bp_code) 'dealer', account, bp_code, registered_name, mdm_name, area, auth.uid()
  from _plan p where not exists (select 1 from accounts a where a.bp_code = p.bp_code)
  order by bp_code, month desc;

  update accounts a set company_name = p.account, registered_name = coalesce(p.registered_name, a.registered_name),
         mdm_name = coalesce(p.mdm_name, a.mdm_name), area = coalesce(p.area, a.area), active = true
  from (select distinct on (bp_code) * from _plan order by bp_code, month desc) p
  where a.bp_code = p.bp_code;

  -- 3. Replace targets from the effective month to December.
  delete from account_targets where month >= eff and month < make_date(p_year + 1, 1, 1);
  insert into account_targets (bp_code, month, kam_label, kam_email, target_amount, import_id)
  select p.bp_code, p.month, p.kam_label, case when k.status = 'kam' then lower(k.email) end, p.amount, imp
  from _plan p join kam_aliases k on k.alias = p.kam_label
  where p.month >= eff;

  perform public.sync_account_owners();
  return res || jsonb_build_object('applied', true, 'import_id', imp);
end $$;

-- Final DSR of one month. p_rows: [{bp_code, amount, lines}] already summed
-- per BP code from the "Actual Sales" column over the INCLUDED product groups
-- only. p_categories: {column, included: ['RAC','LC','WINDOW'], groups: [{category,
-- lines, amount, included}]} -- the audit trail of what was counted and what
-- was left out. Replaces that month entirely.
create or replace function public.import_sales_actuals(
  p_month date, p_rows jsonb, p_file_name text default null, p_dry_run boolean default true,
  p_categories jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp uuid; res jsonb; errors jsonb := '[]'::jsonb; mon date := date_trunc('month', p_month)::date;
begin
  if not public.is_admin() then raise exception 'Only an admin can load the DSR'; end if;
  if p_month is null then raise exception 'Choose the sales month'; end if;
  if mon > public.manila_month() then raise exception 'The sales month cannot be in the future'; end if;
  -- ACS is credited with RAC, LC and Window AC only. A file without the product-group
  -- split cannot prove MBT was left out, so it is refused.
  if p_categories is null or jsonb_typeof(p_categories->'included') <> 'array'
     or jsonb_array_length(p_categories->'included') = 0 then
    raise exception 'Say which product groups are ACS sales (RAC, LC, Window); the DSR must have a product-group column';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_categories->'included') c where upper(c) not in ('RAC','LC','WINDOW')) then
    raise exception 'Only RAC, LC and Window AC sales are credited to ACS';
  end if;

  drop table if exists _dsr;
  create temp table _dsr on commit drop as
  select btrim(r->>'bp_code') as bp_code, (r->>'amount')::numeric as amount, coalesce((r->>'lines')::int, 1) as lines
  from jsonb_array_elements(p_rows) r;

  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'bad_bp_code', 'bp_code', bp_code)), '[]')
    into errors from _dsr where bp_code is null or bp_code !~ '^[0-9A-Za-z-]{3,20}$';
  select errors || coalesce(jsonb_agg(jsonb_build_object('type', 'duplicate_bp_code', 'bp_code', bp_code)), '[]')
    into errors from (select bp_code from _dsr group by bp_code having count(*) > 1) x;

  res := jsonb_build_object(
    'month', mon,
    'bp_codes', (select count(*) from _dsr),
    'total', (select coalesce(sum(amount), 0) from _dsr),
    'in_plan', (select count(*) from _dsr d where exists (select 1 from accounts a where a.bp_code = d.bp_code)),
    'in_plan_total', (select coalesce(sum(amount), 0) from _dsr d where exists (select 1 from accounts a where a.bp_code = d.bp_code)),
    'replaces_existing', exists (select 1 from sales_actuals where month = mon),
    'categories', p_categories,
    'errors', errors);

  if p_dry_run or jsonb_array_length(errors) > 0 then return res || jsonb_build_object('applied', false); end if;

  insert into data_imports (kind, sales_month, file_name, row_count, account_count, total_amount, summary)
  values ('sales_dsr', mon, p_file_name, (select coalesce(sum(lines), 0) from _dsr), (select count(*) from _dsr), (res->>'total')::numeric, res)
  returning id into imp;
  delete from sales_actuals where month = mon;
  insert into sales_actuals (bp_code, month, actual_sales, line_count, import_id)
  select bp_code, mon, amount, lines, imp from _dsr;
  return res || jsonb_build_object('applied', true, 'import_id', imp);
end $$;

-- Admin maintains the name map from the upload page.
create or replace function public.set_kam_alias(p_alias text, p_status text, p_email text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a text := upper(btrim(regexp_replace(p_alias, '\s+', ' ', 'g')));
begin
  if not public.is_admin() then raise exception 'Only an admin can map plan names'; end if;
  if p_status = 'kam' and not exists (select 1 from org_roster where lower(email) = lower(p_email)) then
    raise exception '% is not on the org roster', p_email;
  end if;
  insert into kam_aliases (alias, status, email, note) values (a, p_status, case when p_status = 'kam' then lower(p_email) end, p_note)
  on conflict (alias) do update set status = excluded.status, email = excluded.email, note = excluded.note, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.account_targets enable row level security;
alter table public.sales_actuals   enable row level security;
alter table public.data_imports    enable row level security;
alter table public.kam_aliases     enable row level security;

create policy targets_read on public.account_targets for select to authenticated
  using (public.can_view_bp(bp_code));
create policy sales_read on public.sales_actuals for select to authenticated
  using (public.can_view_bp(bp_code));
create policy imports_read on public.data_imports for select to authenticated
  using (public.is_global_reader() or public.my_role() in ('channel_head','director'));
create policy aliases_read on public.kam_aliases for select to authenticated
  using (public.is_admin());

-- New functions default to PUBLIC execute. Grant each one only where needed
-- (a blanket re-grant would reopen the service-role-only functions).
revoke execute on function public.manila_month(date) from public, anon;
revoke execute on function public.can_view_bp(text) from public, anon;
revoke execute on function public.owns_dealer(uuid, date) from public, anon;
revoke execute on function public.sales_months_loaded(integer) from public, anon;
revoke execute on function public.sync_account_owners() from public, anon;
revoke execute on function public.guard_account() from public, anon;
revoke execute on function public.can_add_sub_dealer(uuid) from public, anon;
revoke execute on function public.check_fcr_account_owner() from public, anon;
revoke execute on function public.import_target_plan(integer, jsonb, text, date, text, boolean) from public, anon;
revoke execute on function public.import_sales_actuals(date, jsonb, text, boolean, jsonb) from public, anon;
revoke execute on function public.set_kam_alias(text, text, text, text) from public, anon;
grant execute on function public.manila_month(date) to authenticated, service_role;
grant execute on function public.can_view_bp(text) to authenticated, service_role;
grant execute on function public.owns_dealer(uuid, date) to authenticated, service_role;
grant execute on function public.sales_months_loaded(integer) to authenticated, service_role;
grant execute on function public.sync_account_owners() to authenticated, service_role;
grant execute on function public.can_add_sub_dealer(uuid) to authenticated, service_role;
grant execute on function public.import_target_plan(integer, jsonb, text, date, text, boolean) to authenticated;
grant execute on function public.import_sales_actuals(date, jsonb, text, boolean, jsonb) to authenticated;
grant execute on function public.set_kam_alias(text, text, text, text) to authenticated;
