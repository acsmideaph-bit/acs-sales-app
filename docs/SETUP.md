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

## 4. Users

```bash
SUPABASE_URL=https://<PROJECT_REF>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> node scripts/create-users.mjs --dry-run
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs
```

This creates a login for everyone on the roster with a temporary password and writes a CSV on your computer. Give each person their password privately, ask them to change it (Account → New password), then **delete the CSV**. Role, team and direct superior are applied automatically from the roster.

Later changes: Admin → **Users and org chart** → edit the roster → Save and sync. New people still need a login (re-run the script; it only creates missing ones).

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
