-- Visit photo as evidence of customer engagement.
--
-- Confirmed by Ronald (Oct 14, 2026):
-- * ONE photo per FCR, REQUIRED before the acknowledgement request goes out.
-- * Photo files are kept for 2 months (60 days), then deleted by the daily
--   purge (Edge Function purge-fcr-photos). The metadata stays on the FCR.
-- * No location-based flags: KAMs often meet customers away from the
--   customer's office (meals, other venues). The app records where and when
--   and the RSM judges. Only venue-independent flags are shown in the app
--   (photo date differs from visit date; location not shared).
--
-- Where the evidence comes from:
-- * uploaded_at  -- set by the database when the photo is attached (cannot be
--                   set by the KAM).
-- * lat/lng/accuracy_m -- the phone's location read by the app at capture.
-- * taken_at, exif_lat/exif_lng -- from the photo file itself when present
--   (often stripped by phones/browsers; a cross-check, not the primary).
-- * place_label  -- reverse-geocoded address (OpenStreetMap), for reading.

-- 1. Private storage bucket (JPEG only, 2 MB max; the app compresses to ~150 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fcr-photos', 'fcr-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- 2. Photo record (one per FCR).
create table if not exists public.fcr_photos (
  id            uuid primary key default gen_random_uuid(),
  fcr_id        uuid not null unique references public.fcrs(id) on delete cascade,
  owner_id      uuid not null references public.user_profiles(id) on delete cascade,
  storage_path  text not null,
  uploaded_at   timestamptz not null default now(),
  taken_at      timestamptz,
  exif_lat      double precision,
  exif_lng      double precision,
  lat           double precision,
  lng           double precision,
  accuracy_m    double precision,
  place_label   text,
  width         int,
  height        int,
  bytes         int,
  purged_at     timestamptz
);

alter table public.fcr_photos enable row level security;
-- Visible to whoever can see the FCR (the subquery runs under fcrs RLS).
create policy fcr_photos_read on public.fcr_photos for select to authenticated
  using (exists (select 1 from public.fcrs f where f.id = fcr_id));
grant select on public.fcr_photos to authenticated;
revoke insert, update, delete on public.fcr_photos from anon, authenticated;

-- 3. Storage rules. Files live at <owner_id>/<fcr_id>/<random>.jpg.
create policy fcr_photos_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fcr-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_writer() and public.my_role() = 'kam'
  );
-- Read: the owner's own folder, or any photo attached to an FCR the viewer can see.
create policy fcr_photos_view on storage.objects for select to authenticated
  using (
    bucket_id = 'fcr-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.fcr_photos p where p.storage_path = name)
    )
  );
-- Delete: only the owner, and only a file that is not attached to an FCR whose
-- acknowledgement request already went out (the evidence is locked then).
create policy fcr_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'fcr-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.fcr_photos p join public.fcrs f on f.id = p.fcr_id
      where p.storage_path = name and f.ack_status <> 'not_sent'
    )
  );

-- 4. Attach (or replace) the photo. Returns the previous file path, if any,
--    so the app can delete the old file.
create or replace function public.attach_fcr_photo(
  p_fcr uuid, p_path text,
  p_taken_at timestamptz default null, p_exif_lat double precision default null, p_exif_lng double precision default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_place text default null, p_width int default null, p_height int default null, p_bytes int default null
) returns text language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype; old_path text;
begin
  select * into f from fcrs where id = p_fcr for update;
  if not found or f.owner_id <> auth.uid() then raise exception 'Not your FCR'; end if;
  if not public.is_writer() then raise exception 'Your account is read-only'; end if;
  if f.status not in ('draft','rejected') then raise exception 'This FCR is already %', f.status; end if;
  if f.ack_status <> 'not_sent' then
    raise exception 'The photo is locked once the acknowledgement request has gone out. Edit the report first if it must change.';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Invalid photo path'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'fcr-photos' and o.name = p_path) then
    raise exception 'Upload the photo first';
  end if;

  select storage_path into old_path from fcr_photos where fcr_id = p_fcr;
  delete from fcr_photos where fcr_id = p_fcr;
  insert into fcr_photos (fcr_id, owner_id, storage_path, taken_at, exif_lat, exif_lng, lat, lng, accuracy_m, place_label, width, height, bytes)
  values (p_fcr, auth.uid(), p_path, p_taken_at, p_exif_lat, p_exif_lng, p_lat, p_lng, p_accuracy,
          left(nullif(trim(coalesce(p_place, '')), ''), 300), p_width, p_height, p_bytes);
  return nullif(old_path, p_path);
end $$;
revoke execute on function public.attach_fcr_photo(uuid, text, timestamptz, double precision, double precision, double precision, double precision, double precision, text, int, int, int) from public, anon;
grant execute on function public.attach_fcr_photo(uuid, text, timestamptz, double precision, double precision, double precision, double precision, double precision, text, int, int, int) to authenticated;

-- 5. Photo required before the acknowledgement request (both email and Viber
--    go through this function).
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
  if not exists (select 1 from fcr_photos p where p.fcr_id = p_id) then
    raise exception 'Take the visit photo before requesting acknowledgement';
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

-- 6. Retention (60 days). The purge Edge Function lists files older than the
--    limit (attached or orphaned), deletes them through the Storage API, then
--    marks the records. Service role only.
create or replace function public.fcr_photo_files_to_purge(p_days int default 60)
returns table (name text) language sql stable security definer set search_path = public as $$
  select o.name from storage.objects o
  where o.bucket_id = 'fcr-photos' and o.created_at < now() - make_interval(days => p_days)
  order by o.created_at
  limit 1000
$$;
create or replace function public.mark_fcr_photos_purged(p_names text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update fcr_photos set purged_at = now() where storage_path = any(p_names) and purged_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fcr_photo_files_to_purge(int) from public, anon, authenticated;
revoke execute on function public.mark_fcr_photos_purged(text[]) from public, anon, authenticated;
grant execute on function public.fcr_photo_files_to_purge(int) to service_role;
grant execute on function public.mark_fcr_photos_purged(text[]) to service_role;
