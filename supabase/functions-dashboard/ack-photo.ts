// ack-photo -- single-file build of supabase/functions/ack-photo + _shared (for dashboard deploy).
// Visit photo for the public acknowledgement page (Ronald, Oct 15, 2026).
//
// The customer confirms the minutes and the meeting photo together. Photos sit
// in a private bucket and the customer has no login, so this function checks
// the acknowledgement token (live request only: pending or acknowledged) and
// returns a signed URL that expires in 10 minutes. Nothing else can be listed
// or fetched through it. Deploy with verify_jwt off (public page).
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

const BUCKET = "fcr-photos";
const URL_TTL_SECONDS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  if (!UUID.test(token)) return json({ ok: false, error: "Invalid link" }, 404);

  const { data, error } = await admin.rpc("fcr_ack_photo", { p_token: token });
  if (error) return json({ ok: false, error: "Not available" }, 500);
  const row = (data || [])[0];
  if (!row) return json({ ok: true, photo: null });
  if (row.purged_at) return json({ ok: true, photo: { purged: true, taken_at: row.taken_at, place: row.place_label } });

  const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, URL_TTL_SECONDS);
  if (sErr || !signed?.signedUrl) return json({ ok: true, photo: null });
  return json({ ok: true, photo: { url: signed.signedUrl, taken_at: row.taken_at, place: row.place_label } });
});
