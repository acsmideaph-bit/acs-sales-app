-- Get-back items + AI cache: RLS and workflow smoke test (fake people only).
-- Run on a local database after 00_local_auth_stub.sql and all migrations:
--   psql -v ON_ERROR_STOP=1 -f 05_get_back_ai_smoke.sql
-- Everything happens inside one transaction that is rolled back.
begin;

-- People: two KAMs under two RSMs, both RSMs under a Channel Head.
insert into org_roster (email, full_name, role, supervisor_email) values
  ('ch@test.local',   'Test Channel Head', 'channel_head', null),
  ('rsm1@test.local', 'Test RSM One',      'rsm', 'ch@test.local'),
  ('rsm2@test.local', 'Test RSM Two',      'rsm', 'ch@test.local'),
  ('kam1@test.local', 'Test KAM One',      'kam', 'rsm1@test.local'),
  ('kam2@test.local', 'Test KAM Two',      'kam', 'rsm2@test.local');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'ch@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'rsm1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'rsm2@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'kam1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'kam2@test.local');

-- Accounts and FCRs are created as the workflow (bypasses the plan rules,
-- which have their own tests).
select set_config('app.workflow', 'on', true);
insert into accounts (id, account_type, company_name, kam_id, bp_code) values
  ('10000000-0000-0000-0000-000000000001', 'dealer', 'ZZ Test Aircon One', '00000000-0000-0000-0000-0000000000b1', 'ZZTEST1'),
  ('10000000-0000-0000-0000-000000000002', 'dealer', 'ZZ Test Aircon Two', '00000000-0000-0000-0000-0000000000b2', 'ZZTEST2');

-- New-format FCR (rows with due dates) and an old-format FCR (free text).
insert into fcrs (id, owner_id, account_id, template_id, template_version, visit_date, status, ack_status, form_data) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001',
   'acs_dealer', 3, current_date - 3, 'pending_approval', 'acknowledged',
   '{"get_back_items": {"f": {}, "rows": [{"item": "Send revised price list", "due_date": "2026-10-30"}, {"item": "", "due_date": ""}, {"item": "Confirm Q4 promo stock", "due_date": "2026-02-31"}]}}'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000002',
   'acs_dealer', 2, current_date - 2, 'pending_approval', 'acknowledged',
   '{"get_back_items": "Deliver brochures\n\nSchedule product training"}');
select set_config('app.workflow', '', true);

do $$ begin
  assert (select count(*) from get_back_items) = 0, 'no items before approval';
end $$;

-- RSM One approves KAM One's FCR -> two items (blank row skipped, bad date -> null).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select review_fcr('20000000-0000-0000-0000-000000000001', true, null);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select review_fcr('20000000-0000-0000-0000-000000000002', true, null);
reset role;

do $$ begin
  assert (select count(*) from get_back_items where fcr_id = '20000000-0000-0000-0000-000000000001') = 2, 'two rows from the grid';
  assert (select due_date from get_back_items where item = 'Send revised price list') = '2026-10-30', 'due date kept';
  assert (select due_date from get_back_items where item = 'Confirm Q4 promo stock') is null, 'invalid date becomes null';
  assert (select count(*) from get_back_items where fcr_id = '20000000-0000-0000-0000-000000000002') = 2, 'two rows from free text';
  assert (select bool_and(status = 'open') from get_back_items), 'all open';
end $$;

-- Visibility: each KAM sees only their own; RSM sees own branch; Channel Head all.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ begin assert (select count(*) from get_back_items) = 2, 'KAM One sees 2'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$ begin assert (select count(*) from get_back_items) = 2, 'RSM Two sees only KAM Two items'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$ begin assert (select count(*) from get_back_items) = 4, 'Channel Head sees all'; end $$;

-- Direct writes are refused (no policies, no grants).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ begin
  begin
    update get_back_items set status = 'done';
    raise exception 'direct update should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- KAM One closes their own item.
select set_get_back_status((select id from get_back_items where item = 'Send revised price list'), 'done', 'Emailed Oct 28');
-- KAM One cannot touch KAM Two's item.
do $$ begin
  begin
    perform set_get_back_status((select id from get_back_items where item = 'Deliver brochures'), 'done', null);
    raise exception 'other KAM should be refused';
  exception when others then
    if sqlerrm not like 'Get-back item not found%' and sqlerrm not like 'Only the KAM%' then raise; end if;
  end;
end $$;
-- RSM Two closes KAM Two's item; dropping needs a reason.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select set_get_back_status((select id from get_back_items where item = 'Deliver brochures'), 'done', null);
do $$ begin
  begin
    perform set_get_back_status((select id from get_back_items where item = 'Schedule product training'), 'dropped', '  ');
    raise exception 'drop without reason should fail';
  exception when others then
    if sqlerrm not like 'Say why%' then raise; end if;
  end;
end $$;
-- RSM One (not KAM Two's superior) is refused, even if the row is passed by id.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare gid uuid;
begin
  reset role;
  select id into gid from get_back_items where item = 'Schedule product training';
  set local role authenticated;
  begin
    perform set_get_back_status(gid, 'done', null);
    raise exception 'RSM of another branch should be refused';
  exception when others then
    if sqlerrm not like 'Only the KAM%' then raise; end if;
  end;
end $$;
-- Reopen clears the closing fields.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select set_get_back_status((select id from get_back_items where item = 'Send revised price list'), 'open', null);
reset role;
do $$ begin
  assert (select status = 'open' and closed_by is null and close_note is null from get_back_items where item = 'Send revised price list'), 'reopened';
  assert (select status = 'done' and closed_by = '00000000-0000-0000-0000-0000000000a2' from get_back_items where item = 'Deliver brochures'), 'closed by RSM';
end $$;

-- AI cache: readable only with the account; not writable by users.
insert into account_insights (account_id, input_hash, source, payload)
values ('10000000-0000-0000-0000-000000000002', 'h', 'rules', '{"priorities": []}');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ begin
  assert (select count(*) from account_insights) = 0, 'KAM One cannot see KAM Two account insights';
  begin
    insert into account_insights (account_id, input_hash, source, payload)
    values ('10000000-0000-0000-0000-000000000001', 'x', 'rules', '{}');
    raise exception 'user insert should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin assert (select count(*) from account_insights) = 1, 'KAM Two sees own account insights'; end $$;

-- Public role: nothing.
set local role anon;
do $$ begin
  begin
    perform 1 from get_back_items;
    raise exception 'anon read should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'get-back + AI smoke test passed' as result;
rollback;
