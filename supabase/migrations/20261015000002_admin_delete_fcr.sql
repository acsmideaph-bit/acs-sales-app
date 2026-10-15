-- Admins can delete any FCR (Ronald, Oct 15, 2026), for duplicates, test
-- entries or reports filed against the wrong account.
--
-- An FCR is evidence, so a deletion is never silent: it needs a reason, it is
-- done only through this RPC, and a full snapshot (report, photo record,
-- request history) is kept in fcr_deletions, readable by admins only.
-- The photo file is removed by the client right after (admin storage policy
-- below); if that step fails, the daily 60-day purge removes it anyway.

create table if not exists public.fcr_deletions (
  id          uuid primary key default gen_random_uuid(),
  fcr_id      uuid not null,
  owner_id    uuid,
  deleted_by  uuid not null references public.user_profiles(id),
  deleted_at  timestamptz not null default now(),
  reason      text not null,
  photo_path  text,
  snapshot    jsonb not null
);
alter table public.fcr_deletions enable row level security;
drop policy if exists fcr_deletions_read on public.fcr_deletions;
create policy fcr_deletions_read on public.fcr_deletions for select to authenticated using (public.is_admin());
grant select on public.fcr_deletions to authenticated;
revoke insert, update, delete on public.fcr_deletions from anon, authenticated;

create or replace function public.admin_delete_fcr(p_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare f fcrs%rowtype; ph fcr_photos%rowtype; snap jsonb;
begin
  if not public.is_admin() or not public.is_writer() then raise exception 'Only an admin can delete an FCR'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for deleting this FCR'; end if;
  select * into f from fcrs where id = p_id for update;
  if not found then raise exception 'FCR not found'; end if;
  select * into ph from fcr_photos where fcr_id = p_id;
  snap := jsonb_build_object(
    'fcr', to_jsonb(f),
    'photo', case when ph.id is null then null else to_jsonb(ph) end,
    'ack_requests', coalesce((select jsonb_agg(to_jsonb(r)) from fcr_ack_requests r where r.fcr_id = p_id), '[]'::jsonb));
  insert into fcr_deletions (fcr_id, owner_id, deleted_by, reason, photo_path, snapshot)
  values (p_id, f.owner_id, auth.uid(), left(trim(p_reason), 1000), ph.storage_path, snap);
  delete from fcrs where id = p_id;          -- photo row and request history cascade
  return ph.storage_path;
end $$;
revoke execute on function public.admin_delete_fcr(uuid, text) from public, anon;
grant execute on function public.admin_delete_fcr(uuid, text) to authenticated;

drop policy if exists fcr_photos_admin_delete on storage.objects;
create policy fcr_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fcr-photos' and public.is_admin() and public.is_writer());

select (select count(*) from pg_proc where proname = 'admin_delete_fcr') as fn,
       (select count(*) from information_schema.tables where table_name = 'fcr_deletions') as audit_table;
