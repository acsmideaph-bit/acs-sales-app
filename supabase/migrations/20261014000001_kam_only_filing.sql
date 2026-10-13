-- Only KAMs file FCRs and MCP Plans.
--
-- Confirmed by Ronald (Oct 14, 2026): RSMs do not submit FCRs to the Channel
-- Head, and the Channel Head does not submit to the Director. Approval stays
-- data-driven (the direct superior approves), but since only KAMs can create
-- FCRs and plans, only RSMs ever have anything to approve.
--
-- Accounts, MCP archives and day notes are unchanged: superiors and admins
-- can still create accounts and generate MCP Actual snapshots for their team.

drop policy if exists fcrs_insert on public.fcrs;
create policy fcrs_insert on public.fcrs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_writer() and public.my_role() = 'kam');

drop policy if exists itin_insert on public.itineraries;
create policy itin_insert on public.itineraries for insert to authenticated
  with check (owner_id = auth.uid() and public.is_writer() and public.my_role() = 'kam');
