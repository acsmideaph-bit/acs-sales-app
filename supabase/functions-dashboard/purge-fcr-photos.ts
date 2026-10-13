// purge-fcr-photos -- single-file build of supabase/functions/purge-fcr-photos + _shared (for dashboard deploy).
// Visit-photo retention (60 days, confirmed by Ronald Oct 14, 2026).
//
// Runs daily at 2:00 AM Manila from pg_cron (acs-purge-fcr-photos). Deletes
// photo files older than the limit through the Storage API (direct SQL
// deletes on storage.objects are not supported), then marks the FCR photo
// records as purged. The time, location and place details stay on the FCR.
// An admin can POST {"dry_run": true} to see what would be deleted.
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
