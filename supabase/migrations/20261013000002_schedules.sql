-- Scheduled digests (pg_cron + pg_net, both free on Supabase).
--
-- pg_cron runs in UTC. Manila is UTC+8 with no daylight saving:
--   Weekly  -- Friday 3:00 PM Manila  = '0 7 * * 5'   (UTC)
--   Monthly -- 1st, 8:00 AM Manila    = '0 0 1 * *'   (UTC), covers last month
-- Friday 3 PM confirmed by Ronald (Oct 13, 2026), instead of end of day, so
-- RSMs get the summary while still at work. FCRs approved after 3 PM Friday
-- appear in the in-app Weekly report (and next week's email only if their
-- visit date falls in that week).
--
-- BEFORE running this file, store two values in Vault (SQL editor):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<long random string>', 'cron_secret');
-- and set the same cron_secret as the Edge Function secret CRON_SECRET.
-- Nothing secret is stored in this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.call_edge_function(fn text) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
$$;
revoke execute on function public.call_edge_function(text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('acs-weekly-digest', 'acs-monthly-digest');
select cron.schedule('acs-weekly-digest',  '0 7 * * 5', $$ select public.call_edge_function('weekly-digest') $$);
select cron.schedule('acs-monthly-digest', '0 0 1 * *', $$ select public.call_edge_function('monthly-digest') $$);
-- Lets the digest Edge Functions verify the x-cron-secret header against Vault
-- (service role only), so the secret never has to be copied anywhere else.
create or replace function public.cron_secret_matches(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p_secret)
$$;
revoke execute on function public.cron_secret_matches(text) from public, anon, authenticated;
grant execute on function public.cron_secret_matches(text) to service_role;
