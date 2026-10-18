-- Security hardening after the Oct 18, 2026 review (Ronald: "go").
--
-- The outside test found nothing readable or writable with the public key.
-- These changes close the remaining gaps:
--   1. Admin rights need a two-step login (password + authenticator code).
--      A stolen admin password alone no longer opens all data.
--   2. The public (anon) role loses its table permissions, and new tables and
--      functions are no longer opened to it by default. RLS already blocked
--      everything; this is a second lock in case a policy is ever wrong.
--   3. Acknowledgement links stop showing the minutes 30 days after the
--      customer confirms, so an old forwarded email can't expose them.

-- ---------------------------------------------------------------------------
-- 1. Two-step login for admins
-- ---------------------------------------------------------------------------
-- Supabase puts the assurance level in the session token: aal1 = password
-- only, aal2 = password + authenticator code. Admin power counts only at aal2.
-- An admin at aal1 is treated as having no admin rights and cannot write; the
-- app sends them to the code screen first.
create or replace function public.jwt_aal() returns text
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from user_profiles where id = auth.uid() and active), false)
     and public.jwt_aal() = 'aal2'
$$;

-- Admin and Viewer read everything (read-only for Viewer); admin only at aal2.
create or replace function public.is_global_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'viewer' or (role = 'admin' and public.jwt_aal() = 'aal2')
                   from user_profiles where id = auth.uid() and active), false)
$$;

-- Can the caller create/edit their own records? Viewers, anyone flagged
-- read_only, and admins who have not passed the two-step login cannot.
create or replace function public.is_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active and not read_only and role <> 'viewer'
                          and (role <> 'admin' or public.jwt_aal() = 'aal2')
                   from user_profiles where id = auth.uid()), false)
$$;

revoke execute on function public.jwt_aal() from public, anon;
grant execute on function public.jwt_aal() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Nothing for the public role except the customer acknowledgement page
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- TRUNCATE ignores RLS. The API never offers it, but no app role needs it.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Functions: only these four stay callable without a login.
do $$
declare
  f record;
  keep text[] := array['get_fcr_ack_details', 'acknowledge_fcr', 'normalize_ph_mobile', 'ping'];
  auth_had boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- skip extension functions
  loop
    continue when f.proname = any(keep);
    auth_had := has_function_privilege('authenticated', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    -- Revoking from PUBLIC must not take anything away from signed-in users.
    if auth_had then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;

-- New tables and functions created later start closed to the public role.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
-- Postgres also lets PUBLIC run every new function unless this is revoked
-- globally (a schema-level revoke can't remove a global default).
-- authenticated keeps its schema-level default grant.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Acknowledgement links expire 30 days after the customer confirms
-- ---------------------------------------------------------------------------
-- A pending link stays usable until the customer confirms (the KAM can always
-- resend). Once confirmed, the page shows the minutes for 30 days; after that
-- it shows only that the meeting was confirmed, and the photo is withheld.
create or replace function public.ack_link_live(p_status text, p_acknowledged_at timestamptz) returns boolean
language sql stable set search_path = public as $$
  select p_status = 'pending'
      or (p_status = 'acknowledged' and p_acknowledged_at > now() - interval '30 days')
$$;
revoke execute on function public.ack_link_live(text, timestamptz) from public, anon;
grant execute on function public.ack_link_live(text, timestamptz) to authenticated, service_role;

create or replace function public.get_fcr_ack_details(p_token uuid)
returns table (
  visit_date date, period text, template_id text, template_version int,
  customer_info jsonb, form_data jsonb,
  attendee_name text, attendee_designation text,
  ack_status text, acknowledged_name text, acknowledged_comment text, acknowledged_at timestamptz,
  submitter_name text, submitter_position text
)
language sql stable security definer set search_path = public as $$
  select f.visit_date, f.period, f.template_id, f.template_version,
         case when live then f.customer_info end,
         case when live then f.form_data end,
         case when live then f.attendee_name end,
         case when live then f.attendee_designation end,
         case when live then f.ack_status else 'expired' end,
         case when live then f.acknowledged_name end,
         case when live then f.acknowledged_comment end,
         f.acknowledged_at,
         p.full_name, p.position
  from fcrs f
  join user_profiles p on p.id = f.owner_id
  cross join lateral (select public.ack_link_live(f.ack_status, f.acknowledged_at) as live) l
  where p_token is not null and f.ack_token = p_token
$$;
revoke execute on function public.get_fcr_ack_details(uuid) from public;
grant execute on function public.get_fcr_ack_details(uuid) to anon, authenticated;

create or replace function public.fcr_ack_photo(p_token uuid)
returns table (storage_path text, taken_at timestamptz, place_label text, purged_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.storage_path, coalesce(p.taken_at, p.uploaded_at), p.place_label, p.purged_at
  from fcrs f join fcr_photos p on p.fcr_id = f.id
  where p_token is not null and f.ack_token = p_token
    and public.ack_link_live(f.ack_status, f.acknowledged_at)
$$;
revoke execute on function public.fcr_ack_photo(uuid) from public, anon, authenticated;
grant execute on function public.fcr_ack_photo(uuid) to service_role;
