# ACS Sales Operations – working notes for Claude Code

Separate product from the MBT Sales Operations app. Shares nothing with MBT:
own Supabase project, own GitHub account, own sender email
(`acs.mideaph@gmail.com`), own users. **Verify the Supabase project ref before
every query or migration** (`list_projects`); the MBT org has auto-connected
to the wrong project before.

## Non-negotiables

- **RLS is the only access-control layer.** Pages query normally; policies
  decide what comes back. Never filter by role in the client to "secure"
  anything. If a report looks like it is missing data, check RLS and the
  user's supervisor chain first.
- **Approval routing is data, not code.** `user_profiles.supervisor_id`
  (from `org_roster.supervisor_email`) decides who approves whom. Only the
  DIRECT superior approves (`review_fcr`, `review_itinerary`). Everyone above
  sees the whole branch (`is_above`, `my_branch`). **Only KAMs file**
  FCRs and MCP Plans (`fcrs_insert`/`itin_insert` policies, `canFile`), so
  in practice only RSMs approve.
- **Workflow fields move only through RPCs.** Status, acknowledgement and
  review columns are protected by the `guard_fcr` / `guard_itinerary`
  triggers. Client UPDATEs can only change content. Add new transitions as
  SECURITY DEFINER functions that `set_config('app.workflow','on',true)`.
- **What the customer confirms is what is archived.** Editing form_data,
  customer_info, attendee or account after the ack request resets the
  acknowledgement (trigger). `buildMinutes()` in `src/lib/fcrMinutes.js` is
  the single source for the preview, the public page and the PDF.
- **Every schema change goes in `supabase/migrations/`** as a new timestamped
  file. Never change the live database by hand without committing the SQL.
- **Free tier only.** Flag anything that would need a paid component.

## Conventions

- Week = **Monday–Sunday** everywhere (`src/lib/dates.js` and
  `supabase/functions/_shared/mail.ts`). Don't introduce another definition.
- Date-only strings go through `parseISO` (`toDate()` in dates.js), never
  `new Date('yyyy-MM-dd')`.
- FCR forms are templates in `src/lib/fcrTemplates.js`. To change a form:
  add a new version object, register it in `TEMPLATES`, point `CURRENT` at
  it. Never edit a version that FCRs were already filed under.
- Team reports list `FILER_ROLES` (`src/lib/roles.js`, currently KAMs only).
- PDF/Excel/zip code is lazy-loaded via `src/lib/lazy.js`; keep heavy
  imports out of the main bundle.
- Emails: always send a real plain-text part and log every attempt to
  `email_log` (`sendMail()` in `_shared/mail.ts`).
- Design: neutral palette + one accent (`tailwind.config.js` tokens), Inter,
  dense tables, no gradients or decorative cards. Reuse the component
  classes in `src/index.css`.
- Commit messages and comments explain **why**. Run `npx vite build` before
  every push.

## Testing

- `supabase/tests/` holds a local RLS/workflow smoke test that runs on plain
  Postgres with a stub `auth` schema:
  `psql -f 00_local_auth_stub.sql && psql -f ../migrations/...init.sql && psql -f ../seed/org_roster.sql && psql -f 01_workflow_rls_smoke.sql`
- Edge Functions: `deno check supabase/functions/*/index.ts`.

## Known gotchas

- GitHub Pages deploy can hang on `deployment_in_progress`: Settings → Pages →
  Unpublish site, re-run the job.
- pg_cron runs in UTC (Friday 3 PM Manila = `0 7 * * 5`). pg_net responses
  expire quickly; outcomes are in `email_log`.
- Gmail "sent" ≠ delivered. Corporate gateways may quarantine consumer Gmail.
  Approval queues, the weekly report page and "Copy link" exist so nothing
  depends on email alone.
