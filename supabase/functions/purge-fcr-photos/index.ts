// Visit-photo retention (60 days, confirmed by Ronald Oct 14, 2026).
//
// Runs daily at 2:00 AM Manila from pg_cron (acs-purge-fcr-photos). Deletes
// photo files older than the limit through the Storage API (direct SQL
// deletes on storage.objects are not supported), then marks the FCR photo
// records as purged. The time, location and place details stay on the FCR.
// An admin can POST {"dry_run": true} to see what would be deleted.
import { admin, corsHeaders, json, resolveCaller } from "../_shared/mail.ts";

const RETENTION_DAYS = 60;
const BUCKET = "fcr-photos";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const caller = await resolveCaller(req);
  if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const dryRun = caller.kind === "admin" && body?.dry_run === true;

  const { data: rows, error } = await admin.rpc("fcr_photo_files_to_purge", { p_days: RETENTION_DAYS });
  if (error) return json({ ok: false, error: error.message }, 500);
  const names: string[] = (rows || []).map((r: { name: string }) => r.name);
  if (dryRun || names.length === 0) return json({ ok: true, dry_run: dryRun, files: names.length, sample: names.slice(0, 5) });

  let removed = 0;
  const failed: string[] = [];
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const { data, error: rmErr } = await admin.storage.from(BUCKET).remove(chunk);
    if (rmErr) { failed.push(rmErr.message); continue; }
    removed += data?.length || 0;
    await admin.rpc("mark_fcr_photos_purged", { p_names: chunk });
  }
  return json({ ok: failed.length === 0, files: names.length, removed, failed });
});
