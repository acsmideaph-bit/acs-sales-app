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
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const APP_URL = (Deno.env.get("APP_URL") || "https://example.github.io/acs-sales-app/").replace(/\/?$/, "/");
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "acs.mideaph@gmail.com";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");
const FROM_NAME = Deno.env.get("MAIL_FROM_NAME") || "ACS Sales Operations";

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function escapeHtml(s: unknown): string {
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

export type MailInput = {
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

export async function sendMail(m: MailInput): Promise<{ result: "sent" | "failed" | "skipped"; error?: string }> {
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
export function manilaToday(): Date {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function fmtLong(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// THE week definition for the whole app: Monday to Sunday (matches
// src/lib/week.js). The Friday digest covers Monday through the run date.
export function weekToDate(): { start: string; end: string } {
  const now = manilaToday();
  const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now.getTime() - sinceMonday * 86400000);
  return { start: ymd(monday), end: ymd(now) };
}

// Who is calling? Cron (shared secret), an admin user (test / preview), or
// nobody we accept.
export async function resolveCaller(req: Request): Promise<{ kind: "cron" } | { kind: "admin"; userId: string; email: string } | null> {
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

export type Profile = {
  id: string; full_name: string; email: string; notify_email: string | null;
  role: string; team: string | null; supervisor_id: string | null; active: boolean;
};

export async function loadProfiles(): Promise<Profile[]> {
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, full_name, email, notify_email, role, team, supervisor_id, active")
    .eq("active", true);
  if (error) throw error;
  return data || [];
}

// All descendants of rootId, depth-first, with their depth.
export function branchOf(rootId: string, profiles: Profile[]): Profile[] {
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

export const BRAND = "#0A5CC2";
export function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d1d1f;max-width:720px;">
  <p style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73;margin:0 0 4px;">ACS Sales Operations &middot; Concepcion Midea Inc.</p>
  <h2 style="font-size:20px;margin:0 0 16px;font-weight:600;">${escapeHtml(title)}</h2>
  ${bodyHtml}
  <p style="font-size:12px;color:#6e6e73;margin-top:28px;border-top:1px solid #e5e5ea;padding-top:12px;">
    Sent by ACS Sales Operations. The same information is always available in the app: <a href="${APP_URL}" style="color:${BRAND};">${APP_URL}</a>
  </p></div>`;
}
