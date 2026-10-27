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
  in practice only RSMs approve. **Exception:** a non-KAM who holds dealers
  in the TTA plan this year (Marc Co, Oct 18, 2026) files for those dealers
  only (`is_filer()`, `holds_dealers()`); his direct superior approves.
  Team reports use `fetchFilers()` (KAMs + dealer holders), not FILER_ROLES alone.
- **Account visibility follows ownership** (Oct 18, 2026): a KAM sees only
  their accounts (dealers held this or last month, their sub-dealers, accounts
  on their own FCRs); an RSM only their KAMs' accounts; Channel Head,
  Director and admins all (`accounts_read` + `can_view_account`, `can_view_bp`).
- **Admin rights need the two-step login** (Oct 18, 2026): `is_admin()`,
  `is_global_reader()` and `is_writer()` treat an admin as powerless unless the
  session is `aal2` (`jwt_aal()`); the app shows `TwoStep` first. The anon role
  has no table grants and may call only the four acknowledgement/utility
  functions; new objects start closed to anon (default privileges) while
  `authenticated` still gets them by default; keep revoking anon/public on
  anything sensitive anyway. Ack links expire 30 days after
  confirmation (`ack_link_live`). Tests: `supabase/tests/04_security_smoke.sql`.
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

- **Dealers are keyed by BP code and owned per month.** Dealers come only from
  the TTA plan upload (`import_target_plan`, admin, all-or-nothing); KAMs add
  sub-dealers (`accounts_insert` policy + `guard_account`). `account_targets`
  holds one KAM and target per dealer per month; the VISIT month decides who
  may file (`check_fcr_account_owner` trigger). `accounts.kam_id` is the
  current month's owner, set by `sync_account_owners()` (import + daily cron
  `acs-sync-account-owners`). Official sales = final DSR "Actual Sales" per BP
  code, RAC + LC + Window AC lines only, MBT never (`parseDsr`, `import_sales_actuals`
  refuses other groups and files without a product-group column). Plan names map to roster
  emails in `kam_aliases`. Dealer FCRs (template acs_dealer v2) carry a frozen
  `account_performance` snapshot (lib/targets.js), shown in minutes and PDF.
  Plan/DSR files, aliases seed and target tests stay out of git (company data).

- **Visit photo is evidence.** One per FCR (`fcr_photos`, private bucket `fcr-photos`, path `<owner>/<fcr>/<uuid>.jpg`), attached only through `attach_fcr_photo`, required by `ensure_fcr_ack_token`, locked once the request is out. Files purge after 60 days (`purge-fcr-photos`, cron `acs-purge-fcr-photos`); keep the metadata. Don't add location-distance flags (Ronald, Oct 14, 2026). Photos come only from the in-app live camera on a phone (`CameraCapture`; laptops hand off by QR in `VisitPhoto`), never a file input; `attach_fcr_photo` rejects a photo without location. FCR saves are guarded by `updated_at` (stale copy on another device can't overwrite). The customer sees the photo on the ack page through the `ack-photo` Edge Function (10-minute signed URL, live token only, verify_jwt off); never make the bucket public.

- **Get-back items are tracked commitments** (Oct 27, 2026). Current forms
  (dealer v3, sub-dealer v2) store them as rows `{item, due_date}`; older forms
  as free text. Always read them with `getBackItems()` (JS) or
  `fcr_get_back_list()` (SQL). Rows open in `get_back_items` when the FCR is
  APPROVED (trigger) and move only through `set_get_back_status` (the KAM who
  promised, the account's current KAM, or the direct superior of either; a
  drop needs a reason). Due dates are required before the ack request.
- **AI = Gemini free tier, wording only** (Oct 27, 2026). Edge Function
  `account-insights`: rules in `_shared/insights.ts` pick and rank priorities;
  Gemini writes why/next action and the KAM/RSM development plan. Gate = the
  caller can see the account (RLS); history is then read with the service
  role. Never send names, contacts or project names to the model (scrubber +
  test `supabase/tests/06_insights_test.ts`). Cached per account in
  `account_insights`; daily caps; every call in `ai_log`; no key = rules text.

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
- Edge Functions: `deno check supabase/functions/*/index.ts`;
  `deno test supabase/tests/06_insights_test.ts` (rules and scrubbing).
- Get-back RLS/RPC: `05_get_back_ai_smoke.sql` (fake people, rolls back).

## Known gotchas

- GitHub Pages deploy can hang on `deployment_in_progress`: Settings → Pages →
  Unpublish site, re-run the job.
- pg_cron runs in UTC (Friday 3 PM Manila = `0 7 * * 5`). pg_net responses
  expire quickly; outcomes are in `email_log`.
- Gmail "sent" ≠ delivered. Corporate gateways may quarantine consumer Gmail.
  Approval queues, the weekly report page and "Copy link" exist so nothing
  depends on email alone.
