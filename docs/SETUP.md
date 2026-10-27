# Setup – ACS Sales Operations

Everything below is free. Ronald does the account steps (account creation and passwords are not something Claude should do on your behalf). Allow about 1–2 hours.

## 1. Gmail sender (acs.mideaph@gmail.com)

1. Sign in to `acs.mideaph@gmail.com` → Google Account → Security → turn on **2-Step Verification**.
2. Security → **App passwords** → create one named "ACS Sales Ops". Copy the 16-character password. You will paste it into Supabase only (step 4). Never put it in code, chat or GitHub.

## 2. Supabase project

1. Sign up at supabase.com **with acs.mideaph@gmail.com** (the MBT organization already uses its two free projects).
2. New project → name `acs-sales-ops`, region **Southeast Asia (Singapore)**, strong database password (keep it in a password manager).
3. Authentication → Sign In / Providers → Email: keep **Email** on, turn **off "Allow new users to sign up"** (only admins create users), and turn off "Confirm email" (admins create users already confirmed).
4. Authentication → URL Configuration → Site URL = your GitHub Pages URL from step 5 (e.g. `https://<github-user>.github.io/acs-sales-app/`). Add the same URL to Redirect URLs (needed for "Forgot password").
5. SQL Editor → run, in order:
   1. `supabase/migrations/20261013000001_init.sql`
   2. `supabase/seed/org_roster.sql` (the roster; git-ignored, keep your local copy)
   3. Vault secrets (replace the values):
      ```sql
      select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
      select vault.create_secret('<a long random string>', 'cron_secret');
      ```
   4. `supabase/migrations/20261013000002_schedules.sql`
   5. The later migrations, in file-name order. For the account targets (Oct 16, 2026):
      `20261016000001_account_targets.sql`, `20261016000002_owner_sync_schedule.sql`, then
      `supabase/seed/kam_aliases.sql` (plan names → roster emails; git-ignored).
      Then, in the app, *Admin → Targets and sales*: load the TTA plan, then each month's final DSR.
      Until the plan is loaded, KAMs cannot file dealer FCRs, so do the two back to back.
6. Project Settings → API: copy the **Project URL** and the **anon public** key (for step 5). The **service_role** key is only for `scripts/create-users.mjs` on your own computer.

## 3. Edge Functions

Install the Supabase CLI (`npm i -g supabase` or `brew install supabase/tap/supabase`), then from the project folder:

```bash
supabase login                       # opens the browser; use the ACS account
supabase link --project-ref <PROJECT_REF>
supabase secrets set GMAIL_USER=acs.mideaph@gmail.com GMAIL_APP_PASSWORD='<16-char app password>' \
  CRON_SECRET='<same string as the cron_secret vault entry>' \
  APP_URL='https://<github-user>.github.io/acs-sales-app/' MAIL_FROM_NAME='ACS Sales Operations'
supabase functions deploy send-fcr-acknowledgment
supabase functions deploy weekly-digest --no-verify-jwt
supabase functions deploy monthly-digest --no-verify-jwt
```

The digests check the `x-cron-secret` header (pg_cron) or an admin's login (Email log page), so `--no-verify-jwt` is safe for them.

### AI priorities (Gemini free tier, Oct 27, 2026)

1. Sign in to Google AI Studio (aistudio.google.com) with **acs.mideaph@gmail.com** and create an API key. Do not add billing: the free tier is enough and nothing can be charged.
2. Supabase → Edge Functions → Secrets: add `GEMINI_API_KEY` = that key. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_FALLBACK_MODEL` (default `gemini-3.1-flash-lite`), `AI_DAILY_CAP` (default 400 calls a day for the whole team), `AI_USER_DAILY_CAP` (default 60 per person).
3. Deploy: `supabase functions deploy account-insights` (JWT verification ON), or Dashboard → Edge Functions → New function `account-insights` → paste `supabase/functions-dashboard/account-insights.ts`.

Without the key the panel still works and says "Rule-based". The free tier of Gemini may use prompts to improve Google products; the function sends business facts only (no customer, owner, contact or project names, no emails or phone numbers). Usage and failures are in the `ai_log` table.

## 4. Users

```bash
SUPABASE_URL=https://<PROJECT_REF>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> node scripts/create-users.mjs --dry-run
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs
```

This creates a login for everyone on the roster with a temporary password and writes a CSV on your computer. Give each person their password privately, ask them to change it (Account → New password), then **delete the CSV**. Role, team and direct superior are applied automatically from the roster.

Later changes: Admin → **Users and org chart** → edit the roster → Save and sync. New people still need a login (re-run the script; it only creates missing ones).

### Account security (security review, Oct 18, 2026)

- **Password policy (server side):** Supabase → Authentication → Sign In / Providers → Email → minimum password length **10**, required characters **letters and digits**. The app checks the same rule.
- **Two-step login for admins:** admins must enter a 6-digit code from an authenticator app after the password. The app asks them to set it up at their next sign-in (QR code); the database grants admin rights only to sessions that passed it (`is_admin()` needs `aal2`). Supabase TOTP is on by default and free; nothing to switch on.
- **Admin lost their phone:** the project owner resets it in the Supabase SQL editor, then the admin sets it up again at the next sign-in:
  ```sql
  delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'name@cmip.com.ph');
  ```
- **Owner accounts:** turn on two-step verification for `acs.mideaph@gmail.com` (Google), the Supabase account and the GitHub account. Whoever controls these can bypass every rule in the app.
- **Public role:** the anon key can call only the acknowledgement page functions (`get_fcr_ack_details`, `acknowledge_fcr`) and `ping`, `normalize_ph_mobile`. New tables and functions start closed to it (signed-in users still get them by default; RLS decides what they see).
- **Acknowledgement links** stop showing the minutes and photo 30 days after the customer confirms.

## 5. GitHub + hosting

1. Create a GitHub account with `acs.mideaph@gmail.com` and a repository named `acs-sales-app`.
2. **Public or private?** GitHub Pages on the free plan needs a **public** repo. That is acceptable because no secrets are committed and the roster seed and ACS source files are git-ignored. If ACS prefers a private repo, use **Cloudflare Pages** (free) instead: build command `npm run build`, output `dist`, environment variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BASE=/`.
3. Repo → Settings → Secrets and variables → Actions → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Repo → Settings → Pages → Source: **GitHub Actions**.
5. Push the code (`git init`, commit, `git push`). The **Deploy to GitHub Pages** workflow builds and publishes. The **Keep Supabase awake** workflow pings the database twice a week so the free project doesn't pause.

## 6. Email reliability – do before launch

1. Ask ACS's IT (and the IT of any big customer) to **allowlist `acs.mideaph@gmail.com`** and to check their quarantine during the test below.
2. Sign in as admin → **Email log** → *Preview weekly* (check content) → *Test weekly to me*.
3. File a test FCR against a test account with your own address as the attendee → *Send for acknowledgement* → confirm it arrives, open the link, confirm.
4. Repeat the send to one mailbox at **every distinct recipient domain** (each RSM's company mailbox and a few customer domains). Confirm arrival before go-live.
5. For the first month, check Email log weekly. "sent" with no arrival = recipient gateway quarantine; ask their IT to search the mail trace.

If ACS already has its own mail domain, sending from it (via its IT, or a free Brevo/Resend tier with SPF/DKIM on that domain) is more reliable than Gmail. Do not buy a domain for this.

## 7. Known operational gotchas

- GitHub Pages deploy stuck on `deployment_in_progress` → Settings → Pages → Unpublish site → re-run the job.
- pg_cron is UTC. Friday 3 PM Manila = `0 7 * * 5`.
- Free Supabase limits (check current values at supabase.com/pricing): database size, egress, and project pausing after inactivity. This app's volume (≈20 users) is far below them.
