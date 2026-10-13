// weekly-digest -- single-file build of supabase/functions/weekly-digest + _shared (for dashboard deploy).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
// Shared mail + logging for every ACS Edge Function.
//
// Gmail SMTP from acs.mideaph@gmail.com with an App Password (free, no domain
// needed). Set as Edge Function secrets: GMAIL_USER, GMAIL_APP_PASSWORD.
// Without them, functions still run and log result = 'skipped'.
//
// Lessons from MBT built in here:
//  * Every attempt is written to email_log -- Gmail "sent" does not mean the
//    corporate gateway delivered it, so we keep our own record to compare
//    against the recipient IT's mail trace.
//  * A real plain-text part (MBT's "This email contains HTML content" stub
//    reads as spam), a consistent sender name, and a Reply-To.


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "https://example.github.io/acs-sales-app/").replace(/\/?$/, "/");
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "acs.mideaph@gmail.com";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");
const FROM_NAME = Deno.env.get("MAIL_FROM_NAME") || "ACS Sales Operations";

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// denomailer's quoted-printable encoder can leave a visible "=20" when the HTML
// has newline + indentation between tags (seen in the MBT digests). Collapsing
// inter-tag whitespace removes the trigger.
function minifyHtml(html: string): string {
  return html.replace(/\n\s*/g, " ").replace(/>\s+</g, "><").trim();
}

type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  kind: string;
  relatedId?: string | null;
  relatedUserId?: string | null;
  triggeredBy?: string | null;
};

async function sendMail(m: MailInput): Promise<{ result: "sent" | "failed" | "skipped"; error?: string }> {
  let result: "sent" | "failed" | "skipped" = "skipped";
  let error: string | undefined;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    error = "GMAIL_USER / GMAIL_APP_PASSWORD not set";
  } else {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
      debug: { encodeLB: true },
    });
    try {
      await client.send({
        from: `${FROM_NAME} <${GMAIL_USER}>`,
        to: [m.to],
        replyTo: m.replyTo || undefined,
        subject: m.subject,
        content: m.text,
        html: minifyHtml(m.html),
      });
      result = "sent";
    } catch (err) {
      result = "failed";
      error = String(err);
      console.error("SMTP error", m.to, err);
    } finally {
      try { await client.close(); } catch (_) { /* already closed */ }
    }
  }

  await admin.from("email_log").insert({
    kind: m.kind,
    recipient: m.to,
    subject: m.subject,
    related_id: m.relatedId ?? null,
    related_user_id: m.relatedUserId ?? null,
    triggered_by: m.triggeredBy ?? null,
    result,
    error: error ?? null,
  });

  return { result, error };
}

// Manila calendar helpers. Shifting by +8h and reading UTC getters gives
// Manila wall-clock components without a timezone library (no DST in PH).
function manilaToday(): Date {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function fmtLong(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// THE week definition for the whole app: Monday to Sunday (matches
// src/lib/week.js). The Friday digest covers Monday through the run date.
function weekToDate(): { start: string; end: string } {
  const now = manilaToday();
  const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now.getTime() - sinceMonday * 86400000);
  return { start: ymd(monday), end: ymd(now) };
}

// Who is calling? Cron (shared secret), an admin user (test / preview), or
// nobody we accept.
async function resolveCaller(req: Request): Promise<{ kind: "cron" } | { kind: "admin"; userId: string; email: string } | null> {
  // Cron calls carry the secret stored in Vault ('cron_secret'). Checked in the
  // database so the value never has to be copied into an Edge Function secret.
  const presented = req.headers.get("x-cron-secret");
  if (presented) {
    const { data: ok } = await admin.rpc("cron_secret_matches", { p_secret: presented });
    if (ok === true) return { kind: "cron" };
  }
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: prof } = await admin.from("user_profiles").select("id, role, active, email, notify_email").eq("id", data.user.id).single();
  if (!prof || !prof.active || prof.role !== "admin") return null;
  return { kind: "admin", userId: prof.id, email: prof.notify_email || prof.email };
}

type Profile = {
  id: string; full_name: string; email: string; notify_email: string | null;
  role: string; team: string | null; supervisor_id: string | null; active: boolean;
};

async function loadProfiles(): Promise<Profile[]> {
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, full_name, email, notify_email, role, team, supervisor_id, active")
    .eq("active", true);
  if (error) throw error;
  return data || [];
}

// All descendants of rootId, depth-first, with their depth.
function branchOf(rootId: string, profiles: Profile[]): Profile[] {
  const out: Profile[] = [];
  const walk = (id: string, depth: number) => {
    if (depth > 12) return;
    for (const p of profiles.filter((x) => x.supervisor_id === id).sort((a, b) => a.full_name.localeCompare(b.full_name))) {
      out.push(p);
      walk(p.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

const BRAND = "#0A5CC2";
function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d1d1f;max-width:720px;">
  <p style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73;margin:0 0 4px;">ACS Sales Operations &middot; Concepcion Midea Inc.</p>
  <h2 style="font-size:20px;margin:0 0 16px;font-weight:600;">${escapeHtml(title)}</h2>
  ${bodyHtml}
  <p style="font-size:12px;color:#6e6e73;margin-top:28px;border-top:1px solid #e5e5ea;padding-top:12px;">
    Sent by ACS Sales Operations. The same information is always available in the app: <a href="${APP_URL}" style="color:${BRAND};">${APP_URL}</a>
  </p></div>`;
}

// Shared digest builder for the weekly (Friday) and monthly (1st) emails.
//
// Recipients come from the org chart in the data: everyone who has at least
// one active direct report gets a digest of THEIR WHOLE BRANCH, grouped by
// each KAM's direct superior. So an RSM sees their KAMs; the Channel Head and
// Director get the roll-up across RSMs. Mail goes to notify_email, falling
// back to the login email.

type Fcr = { id: string; owner_id: string; visit_date: string; period: string; company: string };

async function approvedFcrs(ownerIds: string[], start: string, end: string): Promise<Fcr[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await admin
    .from("fcrs")
    .select("id, owner_id, visit_date, period, customer_info, account:accounts(company_name)")
    .in("owner_id", ownerIds)
    .eq("status", "approved")
    .eq("ack_status", "acknowledged")
    .gte("visit_date", start)
    .lte("visit_date", end)
    .order("visit_date");
  if (error) throw error;
  return (data || []).map((f: any) => ({
    id: f.id, owner_id: f.owner_id, visit_date: f.visit_date, period: f.period,
    company: f.account?.company_name || f.customer_info?.company_name || "Unknown account",
  }));
}

async function plannedCounts(ownerIds: string[], monthStart: string | null): Promise<Record<string, number>> {
  if (!monthStart || !ownerIds.length) return {};
  const { data } = await admin.from("itineraries").select("owner_id, visits, status")
    .in("owner_id", ownerIds).eq("month", monthStart);
  const out: Record<string, number> = {};
  for (const it of data || []) out[it.owner_id] = Array.isArray(it.visits) ? it.visits.length : 0;
  return out;
}

async function pendingForApprover(approverId: string, profiles: Profile[]) {
  const direct = profiles.filter((p) => p.supervisor_id === approverId).map((p) => p.id);
  if (!direct.length) return { fcr: 0, plan: 0 };
  const [{ count: fcr }, { count: plan }] = await Promise.all([
    admin.from("fcrs").select("id", { count: "exact", head: true }).in("owner_id", direct).eq("status", "pending_approval"),
    admin.from("itineraries").select("id", { count: "exact", head: true }).in("owner_id", direct).eq("status", "pending_approval"),
  ]);
  return { fcr: fcr || 0, plan: plan || 0 };
}

const td = "padding:6px 10px;border-bottom:1px solid #e5e5ea;font-size:13px;vertical-align:top;";
const th = "padding:6px 10px;border-bottom:1px solid #c7c7cc;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6e6e73;text-align:left;";

function renderBranch(recipient: Profile, branch: Profile[], fcrs: Fcr[], planned: Record<string, number> | null, profiles: Profile[]) {
  const byOwner = new Map<string, Fcr[]>();
  for (const f of fcrs) byOwner.set(f.owner_id, [...(byOwner.get(f.owner_id) || []), f]);
  // Only people who file (no direct reports of their own), grouped by supervisor.
  const filers = branch.filter((p) => !profiles.some((x) => x.supervisor_id === p.id));
  const groups = new Map<string, Profile[]>();
  for (const p of filers) groups.set(p.supervisor_id || "", [...(groups.get(p.supervisor_id || "") || []), p]);

  let html = "";
  let text = "";
  for (const [supId, members] of groups) {
    const sup = profiles.find((p) => p.id === supId);
    const groupTotal = members.reduce((n, m) => n + (byOwner.get(m.id)?.length || 0), 0);
    const title = supId === recipient.id ? "Your direct reports" : `${sup?.full_name || "Unassigned"}${sup?.team ? ` (${sup.team})` : ""}`;
    html += `<h3 style="font-size:15px;margin:22px 0 6px;font-weight:600;">${escapeHtml(title)} <span style="font-weight:400;color:#6e6e73;">&middot; ${groupTotal} approved visit${groupTotal === 1 ? "" : "s"}</span></h3>`;
    html += `<table style="border-collapse:collapse;width:100%;table-layout:fixed;"><thead><tr>
      <th style="${th}width:32%;">KAM</th>${planned ? `<th style="${th}text-align:right;width:12%;">Planned</th>` : ""}<th style="${th}text-align:right;width:12%;">Approved</th><th style="${th}">Accounts visited</th></tr></thead><tbody>`;
    text += `\n${title} - ${groupTotal} approved visits\n`;
    for (const m of members) {
      const list = byOwner.get(m.id) || [];
      const accounts = list.map((f) => `${fmtLong(f.visit_date).replace(/, \d{4}$/, "")} ${f.period}: ${f.company}`);
      const zero = list.length === 0;
      html += `<tr><td style="${td}${zero ? "color:#b00020;" : ""}">${escapeHtml(m.full_name)}</td>
        ${planned ? `<td style="${td}text-align:right;">${planned[m.id] ?? "–"}</td>` : ""}
        <td style="${td}text-align:right;font-weight:600;${zero ? "color:#b00020;" : ""}">${list.length}</td>
        <td style="${td}color:#3a3a3c;">${zero ? "No approved FCRs" : accounts.map(escapeHtml).join("<br>")}</td></tr>`;
      text += `  ${m.full_name}: ${list.length}${planned ? ` of ${planned[m.id] ?? 0} planned` : ""}${list.length ? "\n    " + accounts.join("\n    ") : ""}\n`;
    }
    html += `</tbody></table>`;
  }
  return { html, text };
}

async function runDigest(req: Request, opts: {
  kind: "weekly_digest" | "monthly_digest";
  range: () => { start: string; end: string; monthStart?: string };
  title: (r: { start: string; end: string }) => string;
  linkPath: (r: { start: string; end: string }) => string;
  intro: string;
}) {
  const caller = await resolveCaller(req);
  if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode: "send" | "preview" | "send_to_me" = caller.kind === "cron" ? "send" : (body.mode || "preview");

  const r = opts.range();
  const profiles = await loadProfiles();
  const recipients = profiles.filter((p) => profiles.some((x) => x.supervisor_id === p.id));
  const results: unknown[] = [];
  const previews: { to: string; subject: string; html: string }[] = [];

  for (const rec of recipients) {
    const branch = branchOf(rec.id, profiles);
    const fcrs = await approvedFcrs(branch.map((b) => b.id), r.start, r.end);
    const planned = opts.kind === "monthly_digest" ? await plannedCounts(branch.map((b) => b.id), r.monthStart || null) : null;
    const pending = await pendingForApprover(rec.id, profiles);
    const { html: branchHtml, text: branchText } = renderBranch(rec, branch, fcrs, planned, profiles);
    const link = `${APP_URL}#${opts.linkPath(r)}`;
    const subject = `${opts.title(r)} - ${rec.team || rec.full_name}`;
    const pendingLine = pending.fcr || pending.plan
      ? `<p style="font-size:13px;background:#fff8e6;border:1px solid #f5d48a;padding:8px 12px;border-radius:6px;">Waiting for your approval: <strong>${pending.fcr}</strong> FCR${pending.fcr === 1 ? "" : "s"} and <strong>${pending.plan}</strong> MCP Plan${pending.plan === 1 ? "" : "s"}. <a href="${APP_URL}#/fcr/approvals" style="color:${BRAND};">Open approvals</a></p>`
      : "";
    const html = shell(opts.title(r), `
      <p style="font-size:14px;line-height:1.55;">Hi ${escapeHtml(rec.full_name.split(" ")[0])}, ${escapeHtml(opts.intro)}
      Only FCRs acknowledged by the customer and approved by the direct superior are counted. KAMs in red have none.</p>
      ${pendingLine}
      ${branchHtml || `<p style="font-size:13px;color:#6e6e73;">No team members found.</p>`}
      <p style="margin:24px 0;"><a href="${link}" style="background:${BRAND};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">Open the report in the app</a></p>
      <p style="font-size:12px;color:#6e6e73;">The app page has the same data plus a download of every FCR and MCP Actual as PDFs.</p>`);
    const text = `${opts.title(r)}\n\n${opts.intro}\n${pending.fcr || pending.plan ? `\nWaiting for your approval: ${pending.fcr} FCRs, ${pending.plan} MCP Plans.\n` : ""}${branchText}\nOpen in the app: ${link}\n`;
    const to = rec.notify_email || rec.email;

    if (mode === "preview") {
      previews.push({ to, subject, html });
      continue;
    }
    const target = mode === "send_to_me" && caller.kind === "admin" ? caller.email : to;
    const res = await sendMail({
      to: target,
      subject: mode === "send_to_me" ? `[TEST for ${to}] ${subject}` : subject,
      html, text,
      kind: mode === "send_to_me" ? "test" : opts.kind,
      relatedUserId: rec.id,
      triggeredBy: caller.kind === "admin" ? caller.userId : null,
    });
    results.push({ to: target, ...res });
  }

  return json({ ok: true, range: r, mode, recipients: recipients.length, results, previews });
}

// Friday digest (pg_cron, Friday 3 PM Manila = '0 7 * * 5' UTC).
// Week = Monday to Sunday everywhere in this app; on Friday it covers
// Monday through today. Admins can POST {mode:"preview"} or
// {mode:"send_to_me"} from the Email Log page to test before launch.


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await runDigest(req, {
      kind: "weekly_digest",
      range: weekToDate,
      title: (r) => `Weekly FCR summary, ${r.start} to ${r.end}`,
      linkPath: (r) => `/reports/weekly?start=${r.start}`,
      intro: "here are the approved Field Contact Reports for your team this week.",
    });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
