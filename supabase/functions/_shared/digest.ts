// Shared digest builder for the weekly (Friday) and monthly (1st) emails.
//
// Recipients come from the org chart in the data: everyone who has at least
// one active direct report gets a digest of THEIR WHOLE BRANCH, grouped by
// each KAM's direct superior. So an RSM sees their KAMs; the Channel Head and
// Director get the roll-up across RSMs. Active admins get the same whole-org
// roll-up as the Director. Mail goes to notify_email, falling
// back to the login email.
import {
  APP_URL, BRAND, Profile, admin, branchOf, escapeHtml, fmtLong, loadProfiles, resolveCaller, json, sendMail, shell,
} from "./mail.ts";

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

export async function runDigest(req: Request, opts: {
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
  // Leaders (anyone with direct reports) get their branch. Admins get the
  // whole ACS line, the same view as the Director (confirmed by Ronald,
  // Oct 13, 2026: admins have maximum access, at least equal to the leaders).
  // Admins always get the whole-ACS view, even if a test KAM reports to them.
  const leaders = profiles.filter((p) => p.role !== "admin" && profiles.some((x) => x.supervisor_id === p.id));
  const orgAdmins = profiles.filter((p) => p.role === "admin");
  const recipients = [...leaders, ...orgAdmins];
  const wholeOrg = (selfId: string) => profiles
    // Test users (team TEST) appear only in their own superior's digest.
    .filter((p) => p.role !== "admin" && p.role !== "viewer" && p.id !== selfId && ((p.team || "").toUpperCase() !== "TEST" || p.supervisor_id === selfId))
    .sort((a, b) => (a.team || "").localeCompare(b.team || "") || a.full_name.localeCompare(b.full_name));
  const results: unknown[] = [];
  const previews: { to: string; subject: string; html: string }[] = [];

  for (const rec of recipients) {
    const isOrgAdmin = orgAdmins.includes(rec);
    const branch = isOrgAdmin ? wholeOrg(rec.id) : branchOf(rec.id, profiles);
    const fcrs = await approvedFcrs(branch.map((b) => b.id), r.start, r.end);
    const planned = opts.kind === "monthly_digest" ? await plannedCounts(branch.map((b) => b.id), r.monthStart || null) : null;
    const pending = await pendingForApprover(rec.id, profiles);
    const { html: branchHtml, text: branchText } = renderBranch(rec, branch, fcrs, planned, profiles);
    const link = `${APP_URL}#${opts.linkPath(r)}`;
    const subject = `${opts.title(r)} - ${isOrgAdmin ? "All ACS" : rec.team || rec.full_name}`;
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
