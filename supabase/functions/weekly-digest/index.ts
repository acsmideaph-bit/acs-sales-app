// Friday digest (pg_cron, Friday 3 PM Manila = '0 7 * * 5' UTC).
// Week = Monday to Sunday everywhere in this app; on Friday it covers
// Monday through today. Admins can POST {mode:"preview"} or
// {mode:"send_to_me"} from the Email Log page to test before launch.
import { corsHeaders, json, weekToDate } from "../_shared/mail.ts";
import { runDigest } from "../_shared/digest.ts";

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
