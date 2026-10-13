// Emails the customer contact a one-click link to review the Minutes of the
// Meeting and confirm the visit happened.
//
// Called by the KAM from the FCR page. The token is issued through the
// ensure_fcr_ack_token RPC using the KAM's own JWT, so ownership, read-only
// and "attendee name required" are enforced by the database, not here.
// Reply-To is the KAM, so a customer who replies reaches a person.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ANON_KEY, APP_URL, BRAND, SUPABASE_URL, admin, corsHeaders, escapeHtml, fmtLong, json, sendMail, shell,
} from "../_shared/mail.ts";

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
