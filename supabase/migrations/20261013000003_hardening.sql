-- Applied Oct 13, 2026 after the Supabase Security Advisor run.
-- Pin search_path on the trigger/helper functions that lacked it.
-- Remaining advisor warnings are by design: the SECURITY DEFINER RPCs
-- (acknowledge_fcr, get_fcr_ack_details for the public acknowledgement page;
-- ensure_fcr_ack_token, is_above, can_view_user for signed-in users) each
-- check ownership/token themselves. pg_net lives in public because Supabase
-- does not support relocating it.
alter function public.guard_itinerary() set search_path = public;
alter function public.guard_fcr() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.in_workflow() set search_path = public;
alter function public.ping() set search_path = public;
