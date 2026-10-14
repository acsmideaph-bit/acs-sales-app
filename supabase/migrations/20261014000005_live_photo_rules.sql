-- Visit photo: live camera on a phone, location required.
--
-- Confirmed by Ronald (Oct 14, 2026): the geotagged, time-stamped photo taken
-- during the visit is crucial for ACS. The app now takes the photo only with
-- the in-app live camera on a phone (no gallery, no file upload; a laptop
-- hands off to the phone by QR code), and refuses to save it without a
-- location fix. The database enforces the location rule and records the
-- device the photo came from, so the RSM can see it.
--
-- What this cannot prevent: a determined user faking the browser or GPS
-- (developer tools, mock-location apps). Server time, location, device,
-- customer confirmation and the RSM's review together make that visible,
-- not impossible.

alter table public.fcr_photos
  add column if not exists device text,           -- e.g. "iPhone · Safari", "Android · Chrome"
  add column if not exists source text;           -- 'live_camera' for photos taken in the app

drop function if exists public.attach_fcr_photo(uuid, text, timestamptz, double precision, double precision, double precision, double precision, double precision, text, int, int, int);

create or replace function public.attach_fcr_photo(
  p_fcr uuid, p_path text,
  p_taken_at timestamptz default null, p_exif_lat double precision default null, p_exif_lng double precision default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_place text default null, p_width int default null, p_height int default null, p_bytes int default null,
  p_device text default null, p_source text default null
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
  if p_lat is null or p_lng is null or p_accuracy is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Location is required for the visit photo. Turn on location for this site and try again.';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Invalid photo path'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'fcr-photos' and o.name = p_path) then
    raise exception 'Upload the photo first';
  end if;

  select storage_path into old_path from fcr_photos where fcr_id = p_fcr;
  delete from fcr_photos where fcr_id = p_fcr;
  insert into fcr_photos (fcr_id, owner_id, storage_path, taken_at, exif_lat, exif_lng, lat, lng, accuracy_m,
                          place_label, width, height, bytes, device, source)
  values (p_fcr, auth.uid(), p_path, p_taken_at, p_exif_lat, p_exif_lng, p_lat, p_lng, p_accuracy,
          left(nullif(trim(coalesce(p_place, '')), ''), 300), p_width, p_height, p_bytes,
          left(nullif(trim(coalesce(p_device, '')), ''), 120), left(nullif(trim(coalesce(p_source, '')), ''), 40));
  return nullif(old_path, p_path);
end $$;
revoke execute on function public.attach_fcr_photo(uuid, text, timestamptz, double precision, double precision, double precision, double precision, double precision, text, int, int, int, text, text) from public, anon;
grant execute on function public.attach_fcr_photo(uuid, text, timestamptz, double precision, double precision, double precision, double precision, double precision, text, int, int, int, text, text) to authenticated;
