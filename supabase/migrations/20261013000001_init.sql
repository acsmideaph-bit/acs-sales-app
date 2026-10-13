-- ACS Sales Operations -- initial schema.
--
-- Design notes (why, not what):
-- * Approval routing comes from DATA (user_profiles.supervisor_id seeded from
--   the ACS org chart), not from hard-coded roles. The MBT app hard-coded
--   "Sales -> NSM, BD -> Head", which cannot represent several RSM branches.
-- * RLS is the only access-control layer. Pages query normally; policies
--   decide what comes back. Never filter by role in the client.
-- * State changes that matter (submit, approve, reject, acknowledge) go through
--   SECURITY DEFINER functions. Direct UPDATEs from the client can edit
--   content but cannot move status, approval or acknowledgement fields --
--   guard triggers enforce that, so an owner cannot approve their own FCR by
--   crafting a request.
-- * FCR answers live in form_data (jsonb) keyed by a template id + version, so
--   a change to the ACS paper form is a template edit, not a migration.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- The org chart as data. Admins maintain it; profiles are created from it
-- when a matching auth user signs up / is created (see handle_new_user).
create table public.org_roster (
  email             text primary key,
  full_name         text not null,
  position          text,
  role              text not null check (role in ('kam','rsm','channel_head','director','admin','viewer')),
  team              text,
  area              text,
  supervisor_email  text,
  notify_email      text,
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);

create table public.user_profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  full_name      text not null,
  position       text,
  -- role drives UI affordances only. WHO approves WHOM is supervisor_id.
  role           text not null default 'viewer'
                 check (role in ('kam','rsm','channel_head','director','admin','viewer')),
  supervisor_id  uuid references public.user_profiles(id) on delete set null,
  team           text,           -- explicit team/unit on every user (MBT lesson 4)
  area           text,
  notify_email   text,           -- where digests go; falls back to email (MBT lesson 2)
  read_only      boolean not null default false,  -- per-user read-only override
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint no_self_supervisor check (supervisor_id is null or supervisor_id <> id)
);
create index on public.user_profiles (supervisor_id);

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies can read user_profiles without
-- recursing into user_profiles' own RLS.
-- ---------------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from user_profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from user_profiles where id = auth.uid() and active), false)
$$;

-- Admin and Viewer read everything (read-only for Viewer).
create or replace function public.is_global_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','viewer') from user_profiles where id = auth.uid() and active), false)
$$;

-- Can the caller create/edit their own records? Viewers and anyone flagged
-- read_only cannot.
create or replace function public.is_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active and not read_only and role <> 'viewer'
                   from user_profiles where id = auth.uid()), false)
$$;

-- True when the caller sits anywhere ABOVE target in the reporting chain.
-- Walks upward from target; depth-capped so a bad supervisor loop in the
-- data can never hang a query.
create or replace function public.is_above(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain(id, depth) as (
    select supervisor_id, 1 from user_profiles where id = target
    union all
    select p.supervisor_id, c.depth + 1
    from chain c join user_profiles p on p.id = c.id
    where c.depth < 12 and p.supervisor_id is not null
  )
  select auth.uid() is not null and exists (select 1 from chain where id = auth.uid())
$$;

create or replace function public.is_direct_superior(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select supervisor_id = auth.uid() from user_profiles where id = target), false)
$$;

-- Self, anyone above in the chain, or a global reader.
create or replace function public.can_view_user(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid() or public.is_above(target) or public.is_global_reader()
$$;

-- Everyone in the caller's branch (all descendants), for reports and the team
-- view. Global readers get every active profile.
create or replace function public.my_branch()
returns table (id uuid, full_name text, role text, team text, supervisor_id uuid, depth int)
language sql stable security definer set search_path = public as $$
  with recursive tree(id, depth) as (
    select p.id, 1 from user_profiles p where p.supervisor_id = auth.uid() and p.active
    union all
    select p.id, t.depth + 1 from tree t join user_profiles p on p.supervisor_id = t.id
    where t.depth < 12 and p.active
  )
  select p.id, p.full_name, p.role, p.team, p.supervisor_id, t.depth
  from tree t join user_profiles p on p.id = t.id
  where not public.is_global_reader()
  union
  select p.id, p.full_name, p.role, p.team, p.supervisor_id, 0
  from user_profiles p
  where public.is_global_reader() and p.active and p.id <> auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Profiles from the roster
-- ---------------------------------------------------------------------------

-- Re-link supervisor_id for every profile from org_roster.supervisor_email.
-- Safe to run any time (admin button "Sync from roster", and after each new
-- user is created).
create or replace function public.sync_profiles_from_roster() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can sync profiles from the roster';
  end if;

  update user_profiles p set
    full_name    = r.full_name,
    position     = r.position,
    role         = r.role,
    team         = r.team,
    area         = r.area,
    notify_email = coalesce(r.notify_email, p.notify_email),
    active       = r.active,
    updated_at   = now()
  from org_roster r
  where lower(r.email) = lower(p.email);

  update user_profiles p set supervisor_id = s.id
  from org_roster r
  left join user_profiles s on lower(s.email) = lower(r.supervisor_email)
  where lower(r.email) = lower(p.email)
    and p.supervisor_id is distinct from s.id;

  get diagnostics n = row_count;
  return n;
end $$;

-- New auth user -> profile. Users not on the roster get an INACTIVE read-only
-- profile: they see nothing and can do nothing until an admin adds them to the
-- roster (an active Viewer would otherwise read everything).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r org_roster%rowtype;
begin
  select * into r from org_roster where lower(email) = lower(new.email);
  insert into user_profiles (id, email, full_name, position, role, team, area, notify_email, read_only, active)
  values (
    new.id, lower(new.email),
    coalesce(r.full_name, split_part(new.email, '@', 1)),
    r.position,
    coalesce(r.role, 'viewer'),
    r.team, r.area, r.notify_email,
    r.email is null,
    r.email is not null and r.active
  )
  on conflict (id) do nothing;

  -- Link this user to their supervisor, and anyone waiting on this user as
  -- their supervisor.
  update user_profiles p set supervisor_id = s.id
  from org_roster ro join user_profiles s on lower(s.email) = lower(ro.supervisor_email)
  where lower(ro.email) = lower(p.email) and p.supervisor_id is distinct from s.id;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Accounts (customer master)
-- ---------------------------------------------------------------------------

create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  account_type          text not null default 'dealer' check (account_type in ('dealer','sub_dealer')),
  company_name          text not null,
  owners                text,
  contact_no            text,
  email                 text,
  business_address      text,
  region                text,
  dealer_classification text,   -- dealer accounts; sub-dealers are always "SUB DEALER"
  channel               text,   -- dealer accounts
  parent_dealer_id      uuid references public.accounts(id) on delete set null,  -- sub-dealers
  visit_freq_days       text,   -- "Visit Freq / Days" on the paper form
  payment_terms         text,
  credit_limit          numeric(14,2),
  contact_person        text,
  contact_designation   text,
  contact_email         text,   -- default acknowledgement recipient
  kam_id                uuid references public.user_profiles(id) on delete set null,
  priority              text check (priority in ('A','B','C')),
  notes                 text,
  active                boolean not null default true,
  created_by            uuid references public.user_profiles(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.accounts (kam_id);
create index on public.accounts (parent_dealer_id);
create unique index accounts_unique_name on public.accounts (lower(trim(company_name)), account_type);

-- ---------------------------------------------------------------------------
-- MCP Plan (monthly call plan)
-- ---------------------------------------------------------------------------

create table public.itineraries (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.user_profiles(id) on delete cascade default auth.uid(),
  month           date not null check (extract(day from month) = 1),
  visits          jsonb not null default '[]'::jsonb,  -- [{id, account_id, visit_date, period, purpose, notes}]
  notes           text,
  status          text not null default 'draft'
                  check (status in ('draft','pending_approval','approved','rejected')),
  submitted_at    timestamptz,
  reviewed_by     uuid references public.user_profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_comment  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, month)
);

-- ---------------------------------------------------------------------------
-- FCR (field contact report)
-- ---------------------------------------------------------------------------

create table public.fcrs (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.user_profiles(id) on delete cascade default auth.uid(),
  account_id            uuid not null references public.accounts(id) on delete restrict,
  template_id           text not null check (template_id in ('acs_dealer','acs_sub_dealer')),
  template_version      integer not null default 1,
  visit_date            date not null,
  period                text not null default 'AM' check (period in ('AM','PM')),
  customer_info         jsonb not null default '{}'::jsonb,  -- header snapshot at filing time
  form_data             jsonb not null default '{}'::jsonb,  -- template answers
  attendee_name         text,
  attendee_designation  text,
  attendee_email        text,
  companion_id          uuid references public.user_profiles(id) on delete set null,
  companion2_id         uuid references public.user_profiles(id) on delete set null,
  status                text not null default 'draft'
                        check (status in ('draft','pending_approval','approved','rejected')),
  ack_status            text not null default 'not_sent'
                        check (ack_status in ('not_sent','pending','acknowledged')),
  ack_token             uuid unique,
  ack_requested_at      timestamptz,
  acknowledged_at       timestamptz,
  acknowledged_name     text,
  acknowledged_comment  text,
  submitted_at          timestamptz,
  reviewed_by           uuid references public.user_profiles(id) on delete set null,
  reviewed_at           timestamptz,
  review_comment        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint companions_distinct check (
    (companion_id is null or companion_id <> owner_id) and
    (companion2_id is null or companion2_id <> owner_id) and
    (companion_id is null or companion2_id is null or companion_id <> companion2_id)
  )
);
create index on public.fcrs (owner_id, visit_date);
create index on public.fcrs (account_id, visit_date desc);
create index on public.fcrs (status);

-- ---------------------------------------------------------------------------
-- MCP Actual: archive + per-day notes
-- ---------------------------------------------------------------------------

create table public.mcp_archive (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.user_profiles(id) on delete cascade,
  month         date not null,
  snapshot      jsonb not null,
  generated_by  uuid references public.user_profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.mcp_archive (owner_id, month);

create table public.mcp_daily_notes (
  user_id    uuid not null references public.user_profiles(id) on delete cascade default auth.uid(),
  note_date  date not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, note_date)
);

-- ---------------------------------------------------------------------------
-- Email log (MBT lesson 1: "sent" is not "delivered" -- keep our own record)
-- ---------------------------------------------------------------------------

create table public.email_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null,          -- fcr_ack | weekly_digest | monthly_digest | test
  recipient        text not null,
  subject          text,
  related_id       uuid,                   -- fcr id for acknowledgements
  related_user_id  uuid,                   -- digest recipient / FCR owner
  result           text not null check (result in ('sent','failed','skipped')),
  error            text,
  triggered_by     uuid
);
create index on public.email_log (created_at desc);
create index on public.email_log (related_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger t_profiles_touch before update on public.user_profiles for each row execute function public.touch_updated_at();
create trigger t_accounts_touch before update on public.accounts for each row execute function public.touch_updated_at();
create trigger t_itin_touch     before update on public.itineraries for each row execute function public.touch_updated_at();
create trigger t_fcrs_touch     before update on public.fcrs for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Guard triggers. Workflow fields only move inside the RPCs below (which set
-- app.workflow = 'on' for the transaction) or from the service role (Edge
-- Functions). Everything else is the owner's content.
-- ---------------------------------------------------------------------------

create or replace function public.in_workflow() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.workflow', true), '') = 'on'
      or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function public.guard_fcr() returns trigger
language plpgsql as $$
begin
  if public.in_workflow() then return new; end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.ack_status := 'not_sent';
    new.ack_token := null; new.ack_requested_at := null;
    new.acknowledged_at := null; new.acknowledged_name := null; new.acknowledged_comment := null;
    new.submitted_at := null; new.reviewed_by := null; new.reviewed_at := null; new.review_comment := null;
    if new.visit_date > (now() at time zone 'Asia/Manila')::date then
      raise exception 'Visit date cannot be in the future';
    end if;
    return new;
  end if;

  -- UPDATE by the owner
  new.owner_id := old.owner_id;
  new.status := old.status;
  new.ack_token := old.ack_token;
  new.ack_status := old.ack_status;
  new.ack_requested_at := old.ack_requested_at;
  new.acknowledged_at := old.acknowledged_at;
  new.acknowledged_name := old.acknowledged_name;
  new.acknowledged_comment := old.acknowledged_comment;
  new.submitted_at := old.submitted_at;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.review_comment := old.review_comment;

  -- Once the acknowledgement request is out, the visit date is fixed.
  if old.ack_requested_at is not null then
    new.visit_date := old.visit_date;
    new.period := old.period;
  elsif new.visit_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Visit date cannot be in the future';
  end if;

  -- What the customer confirmed must be exactly what is archived. If the
  -- owner changes the report after the request went out, the old link dies
  -- and the customer has to confirm the new version.
  if old.ack_status <> 'not_sent' and (
       new.form_data is distinct from old.form_data or
       new.customer_info is distinct from old.customer_info or
       new.attendee_name is distinct from old.attendee_name or
       new.account_id is distinct from old.account_id) then
    new.ack_status := 'not_sent';
    new.ack_token := null;
    new.ack_requested_at := null;
    new.acknowledged_at := null;
    new.acknowledged_name := null;
    new.acknowledged_comment := null;
  end if;
  return new;
end $$;

create trigger t_fcrs_guard before insert or update on public.fcrs
  for each row execute function public.guard_fcr();

create or replace function public.guard_itinerary() returns trigger
language plpgsql as $$
begin
  if public.in_workflow() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.submitted_at := null; new.reviewed_by := null; new.reviewed_at := null; new.review_comment := null;
    return new;
  end if;
  new.owner_id := old.owner_id;
  new.month := old.month;
  new.status := old.status;
  new.submitted_at := old.submitted_at;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.review_comment := old.review_comment;
  return new;
end $$;

create trigger t_itin_guard before insert or update on public.itineraries
  for each row execute function public.guard_itinerary();

-- ---------------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------------

create or replace function public.submit_itinerary(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it itineraries%rowtype; sup uuid;
begin
  select * into it from itineraries where id = p_id for update;
  if not found or it.owner_id <> auth.uid() then raise exception 'Not your MCP Plan'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  if it.status not in ('draft','rejected') then raise exception 'This plan is already %', it.status; end if;
  if jsonb_array_length(it.visits) = 0 then raise exception 'Add at least one visit before submitting'; end if;
  select supervisor_id into sup from user_profiles where id = auth.uid();
  if sup is null then raise exception 'No direct superior is set on your profile. Ask the admin to update the org chart.'; end if;
  perform set_config('app.workflow', 'on', true);
  update itineraries set status = 'pending_approval', submitted_at = now(),
    reviewed_by = null, reviewed_at = null, review_comment = null
  where id = p_id;
end $$;

create or replace function public.review_itinerary(p_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare it itineraries%rowtype;
begin
  select * into it from itineraries where id = p_id for update;
  if not found then raise exception 'MCP Plan not found'; end if;
  if not public.is_direct_superior(it.owner_id) then raise exception 'Only the direct superior can review this plan'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  if it.status <> 'pending_approval' then raise exception 'This plan is not waiting for approval'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required when rejecting'; end if;
  perform set_config('app.workflow', 'on', true);
  update itineraries set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_id;
end $$;

-- Owner reopens an approved plan to change it (e.g. schedule moved). It goes
-- back to draft and must be re-approved.
create or replace function public.reopen_itinerary(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it itineraries%rowtype;
begin
  select * into it from itineraries where id = p_id for update;
  if not found or it.owner_id <> auth.uid() then raise exception 'Not your MCP Plan'; end if;
  if it.status not in ('approved','pending_approval') then return; end if;
  perform set_config('app.workflow', 'on', true);
  update itineraries set status = 'draft', submitted_at = null where id = p_id;
end $$;

-- Issue (or reuse) the acknowledgement token. Used by both "Send email" (via
-- the Edge Function, as the user) and "Copy link" (Viber/WhatsApp fallback).
create or replace function public.ensure_fcr_ack_token(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype; tok uuid;
begin
  select * into f from fcrs where id = p_id for update;
  if not found or f.owner_id <> auth.uid() then raise exception 'Not your FCR'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  if coalesce(trim(f.attendee_name), '') = '' then
    raise exception 'Enter the attendee name before requesting acknowledgement';
  end if;
  if f.ack_status = 'acknowledged' then raise exception 'Already acknowledged'; end if;
  if f.status not in ('draft','rejected') then raise exception 'This FCR is already %', f.status; end if;
  tok := coalesce(f.ack_token, gen_random_uuid());
  perform set_config('app.workflow', 'on', true);
  update fcrs set ack_token = tok, ack_status = 'pending',
    ack_requested_at = coalesce(ack_requested_at, now())
  where id = p_id;
  return tok;
end $$;

-- Public (anon) read of exactly one FCR by token.
create or replace function public.get_fcr_ack_details(p_token uuid)
returns table (
  visit_date date, period text, template_id text, template_version int,
  customer_info jsonb, form_data jsonb,
  attendee_name text, attendee_designation text,
  ack_status text, acknowledged_name text, acknowledged_comment text, acknowledged_at timestamptz,
  submitter_name text, submitter_position text
)
language sql stable security definer set search_path = public as $$
  select f.visit_date, f.period, f.template_id, f.template_version, f.customer_info, f.form_data,
         f.attendee_name, f.attendee_designation,
         f.ack_status, f.acknowledged_name, f.acknowledged_comment, f.acknowledged_at,
         p.full_name, p.position
  from fcrs f join user_profiles p on p.id = f.owner_id
  where p_token is not null and f.ack_token = p_token
$$;

-- Customer confirms. Moves a draft/rejected FCR straight into the direct
-- superior's approval queue.
create or replace function public.acknowledge_fcr(p_token uuid, p_name text, p_comment text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype;
begin
  if p_token is null or coalesce(trim(p_name), '') = '' then return false; end if;
  select * into f from fcrs where ack_token = p_token for update;
  if not found or f.ack_status <> 'pending' then return false; end if;
  perform set_config('app.workflow', 'on', true);
  update fcrs set
    ack_status = 'acknowledged',
    acknowledged_at = now(),
    acknowledged_name = left(trim(p_name), 200),
    acknowledged_comment = nullif(left(trim(coalesce(p_comment, '')), 2000), ''),
    status = case when status in ('draft','rejected') then 'pending_approval' else status end,
    submitted_at = case when status in ('draft','rejected') then now() else submitted_at end,
    reviewed_by = case when status in ('draft','rejected') then null else reviewed_by end,
    reviewed_at = case when status in ('draft','rejected') then null else reviewed_at end
  where id = f.id;
  return true;
end $$;

-- Resubmit an already-acknowledged FCR (e.g. rejected for a reason that did
-- not need content changes).
create or replace function public.submit_fcr(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype; sup uuid;
begin
  select * into f from fcrs where id = p_id for update;
  if not found or f.owner_id <> auth.uid() then raise exception 'Not your FCR'; end if;
  if f.ack_status <> 'acknowledged' then raise exception 'The customer has not acknowledged this FCR yet'; end if;
  if f.status not in ('draft','rejected') then raise exception 'This FCR is already %', f.status; end if;
  select supervisor_id into sup from user_profiles where id = auth.uid();
  if sup is null then raise exception 'No direct superior is set on your profile'; end if;
  perform set_config('app.workflow', 'on', true);
  update fcrs set status = 'pending_approval', submitted_at = now(),
    reviewed_by = null, reviewed_at = null
  where id = p_id;
end $$;

create or replace function public.review_fcr(p_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype;
begin
  select * into f from fcrs where id = p_id for update;
  if not found then raise exception 'FCR not found'; end if;
  if not public.is_direct_superior(f.owner_id) then raise exception 'Only the direct superior can review this FCR'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  if f.status <> 'pending_approval' then raise exception 'This FCR is not waiting for approval'; end if;
  if f.ack_status <> 'acknowledged' then raise exception 'Only acknowledged FCRs can be reviewed'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required when rejecting'; end if;
  perform set_config('app.workflow', 'on', true);
  update fcrs set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_id;
end $$;

-- Users may set where their digests go, nothing else on their own profile.
create or replace function public.set_my_notify_email(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_email is not null and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address';
  end if;
  update user_profiles set notify_email = nullif(trim(p_email), '') where id = auth.uid();
end $$;

-- Keep-alive target for the scheduled GitHub Action (free projects pause after
-- inactivity). Cheap, anonymous, returns no data.
create or replace function public.ping() returns text
language sql stable as $$ select 'ok'::text $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.org_roster      enable row level security;
alter table public.user_profiles   enable row level security;
alter table public.accounts        enable row level security;
alter table public.itineraries     enable row level security;
alter table public.fcrs            enable row level security;
alter table public.mcp_archive     enable row level security;
alter table public.mcp_daily_notes enable row level security;
alter table public.email_log       enable row level security;

-- org_roster: admin only
create policy roster_admin_all on public.org_roster for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_profiles: everyone signed in can read names (dropdowns, companions);
-- only admins change them.
create policy profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or public.my_role() is not null);
create policy profiles_admin_update on public.user_profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- accounts: shared customer master, readable by all signed-in users so the
-- same dealer is not profiled twice. Edits by the assigned KAM, the KAM's
-- superiors, the creator, or an admin.
create policy accounts_read on public.accounts for select to authenticated
  using (public.my_role() is not null);
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.is_writer());
create policy accounts_update on public.accounts for update to authenticated
  using (public.is_writer() and (
    kam_id = auth.uid() or created_by = auth.uid() or public.is_admin()
    or (kam_id is not null and public.is_above(kam_id))))
  with check (public.is_writer());
create policy accounts_delete on public.accounts for delete to authenticated
  using (public.is_admin());

-- itineraries
create policy itin_read on public.itineraries for select to authenticated
  using (public.can_view_user(owner_id));
create policy itin_insert on public.itineraries for insert to authenticated
  with check (owner_id = auth.uid() and public.is_writer());
create policy itin_update on public.itineraries for update to authenticated
  using (owner_id = auth.uid() and public.is_writer() and status in ('draft','rejected'))
  with check (owner_id = auth.uid());
create policy itin_delete on public.itineraries for delete to authenticated
  using (owner_id = auth.uid() and status = 'draft');

-- fcrs
create policy fcrs_read on public.fcrs for select to authenticated
  using (public.can_view_user(owner_id) or companion_id = auth.uid() or companion2_id = auth.uid());
create policy fcrs_insert on public.fcrs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_writer());
create policy fcrs_update on public.fcrs for update to authenticated
  using (owner_id = auth.uid() and public.is_writer() and status in ('draft','rejected'))
  with check (owner_id = auth.uid());
create policy fcrs_delete on public.fcrs for delete to authenticated
  using (owner_id = auth.uid() and status = 'draft' and ack_status <> 'acknowledged');

-- mcp_archive: snapshots are immutable; owner or anyone above can generate.
create policy archive_read on public.mcp_archive for select to authenticated
  using (public.can_view_user(owner_id));
create policy archive_insert on public.mcp_archive for insert to authenticated
  with check (public.is_writer() and (owner_id = auth.uid() or public.is_above(owner_id)));
create policy archive_delete on public.mcp_archive for delete to authenticated
  using (public.is_admin() or (owner_id = auth.uid() and generated_by = auth.uid()));

-- mcp_daily_notes
create policy notes_read on public.mcp_daily_notes for select to authenticated
  using (public.can_view_user(user_id));
create policy notes_write on public.mcp_daily_notes for all to authenticated
  using (user_id = auth.uid() and public.is_writer())
  with check (user_id = auth.uid() and public.is_writer());

-- email_log: written only by Edge Functions (service role bypasses RLS).
create policy email_log_read on public.email_log for select to authenticated
  using (public.is_global_reader() or triggered_by = auth.uid()
         or related_user_id = auth.uid()
         or (related_user_id is not null and public.is_above(related_user_id)));

-- ---------------------------------------------------------------------------
-- Grants. anon gets only the two acknowledgement RPCs and ping.
-- ---------------------------------------------------------------------------

-- Functions are executable by PUBLIC by default, so revoke from PUBLIC and anon
-- first, then grant back only what each role needs.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on function public.get_fcr_ack_details(uuid) to anon, authenticated;
grant execute on function public.acknowledge_fcr(uuid, text, text) to anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
