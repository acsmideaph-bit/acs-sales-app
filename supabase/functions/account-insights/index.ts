// account-insights -- priorities and development advice for one account
// (Ronald, Oct 27, 2026). Rules pick and rank the items; Gemini (free tier)
// writes the why / next action and the KAM and RSM plans. See
// _shared/insights.ts for the split and for what is removed before sending.
//
// Called by a signed-in user from the FCR and Account pages (verify_jwt on).
// The account is read with the CALLER's token first: if RLS hides it, the
// caller gets nothing. Only then is the account's history read with the
// service role, so the current KAM and the RSM see the same advice built from
// every approved visit (including a previous KAM's), as with get-back items.
//
// Free-tier protection: one cached answer per account per day (re-used until
// the facts change), a per-user daily cap and a project-wide daily cap. Over
// a cap, or without GEMINI_API_KEY, the rules' own text is returned.
//
// Secrets: GEMINI_API_KEY (required for AI), GEMINI_MODEL (default
// gemini-3.5-flash-lite), GEMINI_FALLBACK_MODEL (default gemini-3.1-flash-lite),
// AI_DAILY_CAP (default 400), AI_USER_DAILY_CAP (default 60).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ANON_KEY, SUPABASE_URL, admin, corsHeaders, json } from "../_shared/mail.ts";
import {
  type Account, type Fcr, type GetBack, type Inputs, type Insights,
  RESPONSE_SCHEMA, SYSTEM_PROMPT, buildCandidates, buildFacts, mergeModel, performanceFrom, rulesInsights,
} from "../_shared/insights.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.1-flash-lite";
const DAILY_CAP = Number(Deno.env.get("AI_DAILY_CAP") || 400);
const USER_DAILY_CAP = Number(Deno.env.get("AI_USER_DAILY_CAP") || 60);
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const manilaToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
// Start of the Manila day, as a UTC timestamp, for the daily caps.
const manilaDayStartUtc = (today: string) => new Date(`${today}T00:00:00+08:00`).toISOString();

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type GeminiResult = { ok: true; data: unknown; model: string; inTok?: number; outTok?: number } | { ok: false; error: string; retry: boolean };

async function callGemini(model: string, facts: unknown): Promise<GeminiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = `${res.status} ${body?.error?.status || ""} ${body?.error?.message || ""}`.trim();
      // Model missing/retired, over quota or a Google-side error: try the other model.
      return { ok: false, error: msg.slice(0, 300), retry: [404, 429, 500, 503].includes(res.status) || /not found|not supported/i.test(msg) };
    }
    const text = (body?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
    if (!text) return { ok: false, error: `Empty answer (${body?.candidates?.[0]?.finishReason || "no candidates"})`, retry: true };
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { ok: false, error: "Answer was not valid JSON", retry: true }; }
    return { ok: true, data, model, inTok: body?.usageMetadata?.promptTokenCount, outTok: body?.usageMetadata?.candidatesTokenCount };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "Timed out" : String((e as Error).message || e).slice(0, 300), retry: true };
  } finally {
    clearTimeout(timer);
  }
}

async function log(row: Record<string, unknown>) {
  await admin.from("ai_log").insert(row).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ ok: false, error: "Not signed in" }, 401);

    const { account_id, refresh } = await req.json().catch(() => ({}));
    if (!account_id || typeof account_id !== "string") return json({ ok: false, error: "account_id is required" }, 400);

    // Gate: the caller must be able to see the account under RLS.
    const { data: account, error: accErr } = await userClient
      .from("accounts")
      .select("id, account_type, company_name, registered_name, owners, contact_person, region, dealer_classification, channel, priority, payment_terms, credit_limit, bp_code")
      .eq("id", account_id)
      .maybeSingle();
    if (accErr || !account) return json({ ok: false, error: "Account not found or not visible to you" }, 404);

    const today = manilaToday();
    const year = Number(today.slice(0, 4));
    const [fcrRes, gbRes, subRes, cacheRes] = await Promise.all([
      admin.from("fcrs").select("id, visit_date, attendee_name, form_data")
        .eq("account_id", account_id).eq("status", "approved")
        .order("visit_date", { ascending: false }).limit(6),
      admin.from("get_back_items").select("id, item, due_date, promised_on")
        .eq("account_id", account_id).eq("status", "open").order("promised_on"),
      account.account_type === "dealer"
        ? admin.from("accounts").select("id", { count: "exact", head: true }).eq("parent_dealer_id", account_id).eq("active", true)
        : Promise.resolve({ count: null }),
      admin.from("account_insights").select("*").eq("account_id", account_id).maybeSingle(),
    ]);
    if (fcrRes.error) throw fcrRes.error;
    if (gbRes.error) throw gbRes.error;

    let performance = null;
    if (account.bp_code) {
      const [tg, sa, loaded] = await Promise.all([
        admin.from("account_targets").select("month, target_amount").eq("bp_code", account.bp_code).gte("month", `${year}-01-01`).lte("month", `${year}-12-01`),
        admin.from("sales_actuals").select("month, actual_sales").eq("bp_code", account.bp_code).gte("month", `${year}-01-01`).lte("month", `${year}-12-01`),
        admin.rpc("sales_months_loaded", { p_year: year }),
      ]);
      performance = performanceFrom(year, today, tg.data || [], sa.data || [], (loaded.data || []) as string[]);
    }

    const inputs: Inputs = {
      today,
      account: account as Account,
      fcrs: (fcrRes.data || []) as Fcr[],
      getBacks: (gbRes.data || []) as GetBack[],
      performance,
      subDealerCount: (subRes as { count: number | null }).count ?? null,
    };
    const candidates = buildCandidates(inputs);
    const facts = buildFacts(inputs, candidates);
    // Titles are shown but not sent; hash them too so a renamed item refreshes.
    const hash = await sha256(JSON.stringify({ facts, titles: candidates.map((c) => c.title) }));

    const cached = cacheRes.data;
    const fresh = cached && cached.input_hash === hash;
    if (fresh && (!refresh || (cached.source === "gemini" && Date.now() - Date.parse(cached.generated_at) < REFRESH_COOLDOWN_MS))) {
      return json({ ok: true, cached: true, insights: cached });
    }

    const base = rulesInsights(inputs, candidates);
    let result: Insights = base;
    let source: "gemini" | "rules" = "rules";
    let model: string | null = null;
    let logRow: Record<string, unknown> = { user_id: user.id, account_id };

    const dayStart = manilaDayStartUtc(today);
    const [mine, all] = await Promise.all([
      admin.from("ai_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", dayStart).in("result", ["ok", "error", "fallback"]),
      admin.from("ai_log").select("id", { count: "exact", head: true }).gte("created_at", dayStart).in("result", ["ok", "error"]),
    ]);

    if (!GEMINI_API_KEY) {
      result = { ...base, note: "AI is not switched on yet (no Gemini key). Showing rule-based advice." };
      logRow = { ...logRow, result: "fallback", error: "GEMINI_API_KEY not set" };
    } else if ((mine.count || 0) >= USER_DAILY_CAP || (all.count || 0) >= DAILY_CAP) {
      result = { ...base, note: "Today's free AI allowance is used up. Showing rule-based advice; AI resumes tomorrow." };
      logRow = { ...logRow, result: "fallback", error: "daily cap reached" };
    } else {
      let g = await callGemini(MODEL, facts);
      if (!g.ok && g.retry && FALLBACK_MODEL && FALLBACK_MODEL !== MODEL) {
        await log({ ...logRow, model: MODEL, result: "error", error: g.error });
        g = await callGemini(FALLBACK_MODEL, facts);
        if (!g.ok) logRow = { ...logRow, model: FALLBACK_MODEL };
      } else if (!g.ok) {
        logRow = { ...logRow, model: MODEL };
      }
      if (g.ok) {
        result = mergeModel(base, g.data);
        source = "gemini";
        model = g.model;
        logRow = { ...logRow, model: g.model, result: "ok", input_tokens: g.inTok ?? null, output_tokens: g.outTok ?? null };
      } else {
        // Same facts and an AI answer already on file: keep showing that one.
        if (fresh && cached.source === "gemini") {
          await log({ ...logRow, result: "error", error: g.error });
          return json({ ok: true, cached: true, insights: cached });
        }
        result = { ...base, note: "The AI service did not answer. Showing rule-based advice; try Refresh later." };
        logRow = { ...logRow, result: "error", error: g.error };
      }
    }

    const row = {
      account_id, input_hash: hash, source, model, payload: result,
      generated_at: new Date().toISOString(), generated_by: user.id,
    };
    const { error: upErr } = await admin.from("account_insights").upsert(row, { onConflict: "account_id" });
    if (upErr) throw upErr;
    await log(logRow);
    return json({ ok: true, cached: false, insights: row });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error).message || "Unexpected error" }, 500);
  }
});
