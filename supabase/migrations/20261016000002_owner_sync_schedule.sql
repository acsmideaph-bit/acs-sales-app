-- Daily owner sync at 00:05 Manila (16:05 UTC), after
-- 20261016000001_account_targets.sql. Moves each dealer's owner for the new
-- month onto accounts.kam_id on the 1st, with no one touching the app.
-- Separate file so the local Postgres test (no pg_cron) can run the schema.
select cron.unschedule(jobname) from cron.job where jobname = 'acs-sync-account-owners';
select cron.schedule('acs-sync-account-owners', '5 16 * * *', $$ select public.sync_account_owners() $$);
