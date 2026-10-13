-- Viber as a first-class acknowledgement channel, with an audit trail.
--
-- Requested by Ronald (Oct 14, 2026): KAMs can send the acknowledgement link
-- by Viber as readily as by email, and the RSM reviewing the FCR (and the
-- PDF) shows where the request went: channel, number or address, and the
-- name of the person it belongs to.
--
-- * fcrs.attendee_mobile / attendee_mobile_owner: content the KAM types
--   (the customer's Viber number and whose number it is).
-- * fcrs.ack_channel / ack_recipient / ack_recipient_name / ack_last_sent_at:
--   the latest request, protected like the other acknowledgement fields
--   (only request_fcr_ack can set them; they clear when an edit voids the
--   acknowledgement).
-- * fcr_ack_requests: append-only history of every request (resends
--   included). No insert/update/delete policies: rows are written only by
--   request_fcr_ack, so a KAM cannot add or rewrite history.
--
-- Note for auditors: for Viber the app records the number the KAM entered and
-- opens Viber on that number; it cannot see whether the message was actually
-- sent in Viber. The customer's confirmation itself (name, time, comment) is
-- recorded by the acknowledgement page, as before.

alter table public.fcrs
  add column if not exists attendee_mobile       text,
  add column if not exists attendee_mobile_owner text,
  add column if not exists ack_channel           text check (ack_channel in ('email','viber','link')),
  add column if not exists ack_recipient         text,
  add column if not exists ack_recipient_name    text,
  add column if not exists ack_last_sent_at      timestamptz;

create table if not exists public.fcr_ack_requests (
  id              uuid primary key default gen_random_uuid(),
  fcr_id          uuid not null references public.fcrs(id) on delete cascade,
  channel         text not null check (channel in ('email','viber','link')),
  recipient       text,
  recipient_name  text,
  sent_by         uuid references public.user_profiles(id) on delete set null,
  sent_at         timestamptz not null default now()
);
create index if not exists fcr_ack_requests_fcr on public.fcr_ack_requests (fcr_id, sent_at desc);

alter table public.fcr_ack_requests enable row level security;
-- Visible to whoever can see the FCR (the subquery runs under fcrs RLS).
create policy ack_requests_read on public.fcr_ack_requests for select to authenticated
  using (exists (select 1 from public.fcrs f where f.id = fcr_id));
grant select on public.fcr_ack_requests to authenticated;
revoke insert, update, delete on public.fcr_ack_requests from anon, authenticated;

-- Guard: same as before, plus the new acknowledgement-request fields.
create or replace function public.guard_fcr() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.in_workflow() then return new; end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.ack_status := 'not_sent';
    new.ack_token := null; new.ack_requested_at := null;
    new.acknowledged_at := null; new.acknowledged_name := null; new.acknowledged_comment := null;
    new.ack_channel := null; new.ack_recipient := null; new.ack_recipient_name := null; new.ack_last_sent_at := null;
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
  new.ack_channel := old.ack_channel;
  new.ack_recipient := old.ack_recipient;
  new.ack_recipient_name := old.ack_recipient_name;
  new.ack_last_sent_at := old.ack_last_sent_at;
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
  -- and the customer has to confirm the new version. (The request history in
  -- fcr_ack_requests is kept.)
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
    new.ack_channel := null;
    new.ack_recipient := null;
    new.ack_recipient_name := null;
    new.ack_last_sent_at := null;
  end if;
  return new;
end $$;

-- Normalise a Philippine mobile number for Viber: 0917 123 4567 -> +639171234567.
create or replace function public.normalize_ph_mobile(p text) returns text
language sql immutable set search_path = public as $$
  with d as (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as v)
  select case
    when v ~ '^09[0-9]{9}$'      then '+63' || substr(v, 2)
    when v ~ '^639[0-9]{9}$'     then '+' || v
    when v ~ '^\+[0-9]{10,15}$'  then v
    else null end
  from d
$$;

-- Issue (or reuse) the link and record where it is being sent. Called by the
-- app for Viber and Copy link, and by the send-fcr-acknowledgment Edge
-- Function (as the KAM) after an email goes out.
create or replace function public.request_fcr_ack(p_id uuid, p_channel text, p_recipient text default null, p_recipient_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype; tok uuid; rcpt text := nullif(trim(coalesce(p_recipient, '')), ''); nm text := nullif(trim(coalesce(p_recipient_name, '')), '');
begin
  if p_channel not in ('email','viber','link') then raise exception 'Unknown channel'; end if;
  select * into f from fcrs where id = p_id;
  if not found or f.owner_id <> auth.uid() then raise exception 'Not your FCR'; end if;

  if p_channel = 'viber' then
    rcpt := public.normalize_ph_mobile(rcpt);
    if rcpt is null then raise exception 'Enter a valid mobile number for Viber, e.g. 0917 123 4567'; end if;
    if nm is null then raise exception 'Enter the name of the person who owns this Viber number'; end if;
  elsif p_channel = 'email' then
    if rcpt is null or rcpt !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
    nm := coalesce(nm, f.attendee_name);
  end if;

  tok := public.ensure_fcr_ack_token(p_id);   -- ownership, read-only, attendee and status checks

  perform set_config('app.workflow', 'on', true);
  update fcrs set ack_channel = p_channel, ack_recipient = rcpt, ack_recipient_name = nm, ack_last_sent_at = now()
  where id = p_id;
  insert into fcr_ack_requests (fcr_id, channel, recipient, recipient_name, sent_by)
  values (p_id, p_channel, rcpt, nm, auth.uid());
  perform set_config('app.workflow', '', true);
  return tok;
end $$;
revoke execute on function public.request_fcr_ack(uuid, text, text, text) from public, anon;
grant execute on function public.request_fcr_ack(uuid, text, text, text) to authenticated;
