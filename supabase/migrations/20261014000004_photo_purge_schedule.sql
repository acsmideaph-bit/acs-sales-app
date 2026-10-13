-- Daily photo retention purge at 2:00 AM Manila (18:00 UTC), after
-- 20261014000003_fcr_photos.sql. Uses call_edge_function() from
-- 20261013000002_schedules.sql (cron secret from Vault).
select cron.unschedule(jobname) from cron.job where jobname = 'acs-purge-fcr-photos';
select cron.schedule('acs-purge-fcr-photos', '0 18 * * *', $$ select public.call_edge_function('purge-fcr-photos') $$);
