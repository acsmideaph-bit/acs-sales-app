-- Customer sees the visit photo on the acknowledgement page (Ronald, Oct 15, 2026).
--
-- The customer confirms the minutes AND the meeting photo together, which makes
-- the confirmation stronger evidence of the visit. The photo stays in the
-- private bucket: the public page gets a 10-minute signed URL from the Edge
-- Function ack-photo, which only answers for a valid, live acknowledgement token.
--
-- Here: record on the photo row that the customer confirmed with it shown.
-- The photo is locked once the request is out (attach_fcr_photo), so the photo
-- the customer saw is the photo on file.

alter table public.fcr_photos
  add column if not exists customer_confirmed_at timestamptz;   -- set when the customer confirmed with this photo shown

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
  update fcr_photos set customer_confirmed_at = now() where fcr_id = f.id and purged_at is null;
  return true;
end $$;
revoke execute on function public.acknowledge_fcr(uuid, text, text) from public;
grant execute on function public.acknowledge_fcr(uuid, text, text) to anon, authenticated;

-- Used only by the ack-photo Edge Function (service role): the photo for a live token.
create or replace function public.fcr_ack_photo(p_token uuid)
returns table (storage_path text, taken_at timestamptz, place_label text, purged_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.storage_path, coalesce(p.taken_at, p.uploaded_at), p.place_label, p.purged_at
  from fcrs f join fcr_photos p on p.fcr_id = f.id
  where p_token is not null and f.ack_token = p_token and f.ack_status in ('pending', 'acknowledged')
$$;
revoke execute on function public.fcr_ack_photo(uuid) from public, anon, authenticated;
grant execute on function public.fcr_ack_photo(uuid) to service_role;

select 'ok' as result, (select count(*) from information_schema.columns where table_name='fcr_photos' and column_name='customer_confirmed_at') as col,
       (select count(*) from pg_proc where proname='fcr_ack_photo') as fn;
