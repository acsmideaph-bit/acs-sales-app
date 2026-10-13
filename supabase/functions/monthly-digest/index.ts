// Monthly digest (pg_cron, 1st of the month 8 AM Manila = '0 0 1 * *' UTC).
// Covers the whole PREVIOUS month: MCP Actual (approved, acknowledged FCRs)
// per KAM against the number of visits in their MCP Plan.
import { corsHeaders, json, manilaToday, ymd } from "../_shared/mail.ts";
import { runDigest } from "../_shared/digest.ts";

function previousMonth() {
  const now = manilaToday();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: ymd(first), end: ymd(last), monthStart: ymd(first) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await runDigest(req, {
      kind: "monthly_digest",
      range: previousMonth,
      title: (r) => `Monthly MCP Actual, ${new Date(r.start + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`,
      linkPath: (r) => `/mcp/actual?month=${r.start.slice(0, 7)}`,
      intro: "here is last month's MCP Actual for your team, against each KAM's MCP Plan.",
    });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
