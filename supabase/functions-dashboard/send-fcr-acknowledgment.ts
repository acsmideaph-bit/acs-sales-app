// send-fcr-acknowledgment -- single-file build of supabase/functions/send-fcr-acknowledgment + _shared (for dashboard deploy).
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

// Emails the customer contact a one-click link to review the Minutes of the
// Meeting and confirm the visit happened.
//
// Called by the KAM from the FCR page. The token is issued through the
// ensure_fcr_ack_token RPC using the KAM's own JWT, so ownership, read-only
// and "attendee name required" are enforced by the database, not here.
// Reply-To is the KAM, so a customer who replies reaches a person.


const TEMPLATE_LABEL: Record<string, string> = {
  acs_dealer: "Field Contact Report - ACS",
  acs_sub_dealer: "Field Contact Report - Sub Dealer",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Not signed in" }, 401);

    const { fcr_id } = await req.json().catch(() => ({}));
    if (!fcr_id) return json({ ok: false, error: "fcr_id is required" }, 400);

    // Read as the user: RLS guarantees they can see it.
    const { data: fcr, error: fcrErr } = await userClient
      .from("fcrs")
      .select("id, owner_id, template_id, visit_date, period, attendee_name, attendee_email, customer_info, account:accounts(company_name)")
      .eq("id", fcr_id)
      .single();
    if (fcrErr || !fcr) return json({ ok: false, error: "FCR not found" }, 404);
    if (fcr.owner_id !== userData.user.id) return json({ ok: false, error: "Only the KAM who filed this FCR can send it" }, 403);
    if (!fcr.attendee_email) return json({ ok: false, error: "Enter the attendee's email address first, or use Copy link" }, 400);

    const { data: token, error: tokErr } = await userClient.rpc("ensure_fcr_ack_token", { p_id: fcr_id });
    if (tokErr) return json({ ok: false, error: tokErr.message }, 400);

    const { data: kam } = await admin.from("user_profiles").select("full_name, email, position").eq("id", fcr.owner_id).single();
    const company = (fcr as any).account?.company_name || (fcr.customer_info as any)?.company_name || "your company";
    const link = `${APP_URL}#/acknowledge/${token}`;
    const when = `${fmtLong(fcr.visit_date)} (${fcr.period === "PM" ? "afternoon" : "morning"})`;
    const kamName = kam?.full_name || "your Concepcion Midea representative";
    const subject = `Please confirm: meeting with ${kamName} on ${fmtLong(fcr.visit_date)}`;

    const html = shell("Please confirm our meeting", `
      <p style="font-size:14px;line-height:1.55;">Dear ${escapeHtml(fcr.attendee_name)},</p>
      <p style="font-size:14px;line-height:1.55;">Thank you for meeting with ${escapeHtml(kamName)}${kam?.position ? `, ${escapeHtml(kam.position)}` : ""}, on ${escapeHtml(when)}.
      Please review the minutes of the meeting for <strong>${escapeHtml(company)}</strong> and confirm that they are accurate. It takes one click and no login.</p>
      <p style="margin:24px 0;"><a href="${link}" style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">Review and confirm the minutes</a></p>
      <p style="font-size:12px;color:#6e6e73;line-height:1.5;">If the button does not work, copy this address into your browser:<br>${escapeHtml(link)}</p>
      <p style="font-size:12px;color:#6e6e73;line-height:1.5;">${escapeHtml(TEMPLATE_LABEL[fcr.template_id] || "Field Contact Report")} &middot; Questions? Reply to this email to reach ${escapeHtml(kamName)} directly.</p>`);

    const text = [
      `Dear ${fcr.attendee_name},`,
      ``,
      `Thank you for meeting with ${kamName} on ${when}.`,
      `Please review the minutes of the meeting for ${company} and confirm they are accurate (one click, no login):`,
      ``,
      link,
      ``,
      `Questions? Reply to this email to reach ${kamName} directly.`,
      ``,
      `ACS Sales Operations - Concepcion Midea Inc.`,
    ].join("\n");

    const res = await sendMail({
      to: fcr.attendee_email,
      subject,
      html,
      text,
      replyTo: kam?.email,
      kind: "fcr_ack",
      relatedId: fcr.id,
      relatedUserId: fcr.owner_id,
      triggeredBy: userData.user.id,
    });

    if (res.result === "sent") {
      // Record the request in the FCR's audit trail (channel, address, name),
      // as the KAM, so the RSM and the PDF show where it went.
      const { error: logErr } = await userClient.rpc("request_fcr_ack", {
        p_id: fcr_id, p_channel: "email", p_recipient: fcr.attendee_email, p_recipient_name: fcr.attendee_name,
      });
      if (logErr) console.error("request_fcr_ack", logErr.message);
      return json({ ok: true, result: "sent" });
    }
    if (res.result === "skipped") {
      return json({ ok: false, error: "Email is not configured yet (GMAIL secrets missing). Use Copy link instead.", link }, 200);
    }
    return json({ ok: false, error: `Email failed: ${res.error}. Use Copy link instead.`, link }, 200);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
