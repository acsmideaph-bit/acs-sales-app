# ACS Sales Operations

Sales operations web app for the **AC Specialist (ACS)** team of Concepcion Midea Inc. Philippines. Modeled on the MBT Sales Operations app, but a separate product with its own Supabase project, GitHub account, sender email, users and data.

**What it does**

| Area | Who | What |
|---|---|---|
| MCP Plan | KAM → RSM | Plan the month on an AM/PM calendar, submit, the direct superior approves or returns with a comment |
| Accounts | Everyone | Shared customer master (dealers and sub-dealers) with visit history and rule-based discussion points |
| FCR | KAM → customer → RSM | ACS form or Sub Dealer form (picked by account type). Customer confirms the Minutes of the Meeting via a no-login link (email, or copy link for Viber/WhatsApp). Confirmation sends it to the RSM's approval queue |
| MCP Actual | KAM, superiors | Approved + acknowledged FCRs vs plan, team roster for superiors, per-day notes, PDF snapshot to the Archive |
| Digests | RSM, Channel Head, Director | Friday 3 PM weekly summary and monthly MCP Actual on the 1st, by branch. Every attempt is logged |
| Reports | Superiors, admin | Dashboard, weekly report + PDF zip, visitation census, export center (Excel / combined PDF / zip), email log |
| Admin | Admin | Org roster (drives roles and approval routing), per-user read-only, digest preview and test sends |

**Stack** (all free tier): React 18 + Vite 6 + Tailwind, Supabase (Postgres, Auth, RLS, Edge Functions, pg_cron, pg_net), Gmail SMTP from `acs.mideaph@gmail.com`, GitHub Pages. PDFs and Excel files are generated in the browser.

**Start here**
- `docs/SETUP.md` – step-by-step setup of the accounts, database, functions and deploy
- `docs/INTERPRETATION.md` – how the ACS forms and org chart were read, and open questions
- `docs/USER_GUIDE.md` – quick guide and process map for KAMs, RSMs and admins
- `CLAUDE.md` – conventions for anyone (or any Claude session) changing the code

**Local development**
```bash
npm install
cp .env.example .env.local   # fill in the ACS project URL and anon key
npm run dev
npx vite build               # run before every push
```
