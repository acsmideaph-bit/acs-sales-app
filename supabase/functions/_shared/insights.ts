// Account priorities and development advice (Ronald, Oct 27, 2026).
//
// Two layers, on purpose:
//   1. RULES decide WHAT is on the list and in WHICH order (overdue promises,
//      AR commitments, gap to target, stalled projects...). Same facts, same
//      list, for every KAM; an RSM can always see why an item is there.
//   2. GEMINI (free tier) only writes the words: why each item matters, the
//      next action, and a short plan for the KAM and for the RSM to grow the
//      account. If Gemini is down, over quota or not configured, the rules
//      write plain default text and the page says so.
//
// Gemini's free tier may use prompts to improve Google products, so the
// prompt carries business facts only: no company, owner, contact or
// attendee names, no emails or phone numbers, no project names. The rules
// keep the real names for the screen; the model sees refs (C1, C2...).
//
// Pure functions only (no network, no database) so they can be unit-tested.

export type Row = Record<string, unknown>;

export type Account = {
  id: string;
  account_type: string;
  company_name: string;
  registered_name?: string | null;
  owners?: string | null;
  contact_person?: string | null;
  region?: string | null;
  dealer_classification?: string | null;
  channel?: string | null;
  priority?: string | null;
  payment_terms?: string | null;
  credit_limit?: number | string | null;
  bp_code?: string | null;
};

export type Fcr = {
  id: string;
  visit_date: string; // yyyy-mm-dd
  attendee_name?: string | null;
  form_data: Row;
};

export type GetBack = { id: string; item: string; due_date: string | null; promised_on: string };

export type Performance = {
  year: number;
  last_loaded: string | null; // yyyy-mm-01 of the last month with a final DSR
  month_target: number | null; // this month
  fy_target: number;
  ytd_target: number; // Jan .. last_loaded
  ytd_actual: number;
  months: { month: string; target: number | null; actual: number | null }[];
};

export type Inputs = {
  today: string; // yyyy-mm-dd, Manila
  account: Account;
  fcrs: Fcr[]; // approved, newest first
  getBacks: GetBack[]; // open
  performance: Performance | null;
  subDealerCount: number | null; // dealers only
};

export type Candidate = {
  ref: string;
  category: "Get-back" | "Collection" | "Sales gap" | "Project" | "Program" | "Competitor" | "Visit";
  score: number;
  title: string; // shown on screen (may contain real names)
  fact: string; // sent to the model (scrubbed)
  due_date?: string | null;
  overdue_days?: number | null;
  get_back_id?: string | null;
  default_why: string;
  default_action: string;
};

export type Insights = {
  summary: string;
  priorities: {
    ref: string;
    category: Candidate["category"];
    title: string;
    why: string;
    action: string;
    due_date?: string | null;
    overdue_days?: number | null;
    get_back_id?: string | null;
  }[];
  develop: { kam: string[]; rsm: string[] };
  as_of: string;
  note?: string;
};

export const CMIP_PROGRAMS = [
  "Dealer Accreditation", "Service Center Accreditation", "Product Training", "Module and Mock-up Deployment",
  "Product Brochures", "Pro Shop", "Midea Club", "Sub-dealer trainings", "TTA trip incentive (Vietnam / Spain)",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
    Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / DAY);
export const addDays = (ymd: string, n: number) =>
  new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * DAY).toISOString().slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (ymd: string | null | undefined) =>
  isYmd(ymd) ? `${MONTHS[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}, ${ymd.slice(0, 4)}` : "";
const fmtMonth = (ymd: string | null | undefined) => (ymd ? `${MONTHS[+ymd.slice(5, 7) - 1]} ${ymd.slice(0, 4)}` : "");

export const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[,\s₱]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const php = (n: number | null | undefined) =>
  n == null ? "" : `PHP ${Math.round(n).toLocaleString("en-US")}`;

const str = (v: unknown) => String(v ?? "").trim();
const rows = (fd: Row, key: string): Row[] => {
  const v = fd?.[key] as { rows?: unknown } | undefined;
  return Array.isArray(v?.rows) ? (v!.rows as Row[]) : [];
};
const filled = (r: Row, keys: string[]) => keys.some((k) => str(r[k]) !== "");

const CLOSED_PROJECT = ["delivered", "po received", "lost", "won"];
const projectOpen = (status: unknown) => !CLOSED_PROJECT.some((c) => str(status).toLowerCase().includes(c));

// ---------------------------------------------------------------------------
// Scrubbing: what may leave for Gemini
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeScrubber(account: Account, fcrs: Fcr[]) {
  const names = new Set<string>();
  const add = (v: unknown, minLen = 3) => {
    for (const part of str(v).split(/[,/&;]| and /i)) {
      const p = part.trim();
      if (p.length >= minLen) names.add(p);
    }
  };
  add(account.company_name); add(account.registered_name); add(account.owners); add(account.contact_person);
  for (const f of fcrs) add(f.attendee_name);
  // Longest first so "Juan Dela Cruz" goes before "Juan".
  const nameRes = [...names].sort((a, b) => b.length - a.length).map((n) => new RegExp(escapeRe(n), "gi"));
  return (text: unknown): string => {
    let t = str(text);
    if (!t) return "";
    t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
    t = t.replace(/(\+?63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, "[phone]");
    t = t.replace(/\(?\b0?2\)?[\s-]\d{3,4}[\s-]\d{4}\b/g, "[phone]");
    t = t.replace(/\b\d{7,}\b/g, "[number]");
    for (const re of nameRes) t = t.replace(re, "[customer]");
    return t.length > 400 ? `${t.slice(0, 400)}…` : t;
  };
}

// ---------------------------------------------------------------------------
// Rules: candidates in priority order
// ---------------------------------------------------------------------------

export function buildCandidates(inp: Inputs): Candidate[] {
  const { today, fcrs, getBacks, performance } = inp;
  const scrub = makeScrubber(inp.account, fcrs);
  const out: Omit<Candidate, "ref">[] = [];
  const latest = fcrs[0];

  // 1. Open get-back items. No due date (older forms) = a week after the visit.
  for (const g of getBacks) {
    const due = g.due_date || addDays(g.promised_on, 7);
    const late = daysBetween(due, today);
    if (late < -14) continue; // far in the future: not a priority yet
    const score = late > 0 ? 100 + Math.min(late, 30) * 2 : late >= -3 ? 80 : 40;
    const when = late > 0 ? `overdue ${late} day${late === 1 ? "" : "s"}` : late === 0 ? "due today" : `due ${fmtDate(due)}`;
    out.push({
      category: "Get-back", score,
      title: `"${g.item}" (promised ${fmtDate(g.promised_on)}, ${when})`,
      fact: `Promise to the customer on ${g.promised_on}: "${scrub(g.item)}". Due ${due}${g.due_date ? "" : " (no date was set; assumed one week)"}; ${late > 0 ? `${late} days overdue` : late === 0 ? "due today" : `${-late} days left`}.`,
      due_date: due, overdue_days: late > 0 ? late : 0, get_back_id: g.id,
      default_why: late > 0
        ? "The customer confirmed this promise in the minutes; a missed date costs trust."
        : "The customer confirmed this promise in the minutes and the date is close.",
      default_action: late > 0
        ? "Deliver it now, or call the customer with a firm new date, then mark it done."
        : `Prepare it before ${fmtDate(due)} and mark it done once delivered.`,
    });
  }

  if (latest) {
    // 2. AR commitments from the latest visit that are due (or due in 3 days).
    for (const r of rows(latest.form_data, "ar_collection")) {
      const d = str(r.commitment_date);
      if (!isYmd(d)) continue;
      const late = daysBetween(d, today);
      if (late < -3) continue;
      const amt = num(r.amount);
      out.push({
        category: "Collection", score: 90 + Math.min(Math.max(late, 0), 30),
        title: `${amt != null ? php(amt) : "Overdue AR"} committed for ${fmtDate(d)}${str(r.reason) ? ` (${str(r.reason)})` : ""}`,
        fact: `AR overdue ${amt != null ? php(amt) : "(amount not recorded)"}; dealer committed to pay by ${d}${late > 0 ? ` (${late} days ago)` : ""}. Reason given: "${scrub(r.reason)}".`,
        due_date: d, overdue_days: late > 0 ? late : 0,
        default_why: "Unpaid overdue AR limits the credit the dealer can use for new orders.",
        default_action: "Confirm the payment with the dealer's accounting; escalate to the RSM if the date is missed again.",
      });
    }
  }

  // 3. Gap to the official target (dealers with a TTA target and a final DSR).
  if (performance && performance.last_loaded && performance.ytd_target > 0) {
    const ach = performance.ytd_actual / performance.ytd_target;
    const gap = performance.ytd_target - performance.ytd_actual;
    if (ach < 0.9) {
      out.push({
        category: "Sales gap", score: Math.min(95, 60 + Math.round((0.9 - ach) * 60)),
        title: `Sales ${(ach * 100).toFixed(0)}% of target to ${fmtMonth(performance.last_loaded)} (${php(gap)} short)`,
        fact: `Official sales Jan-${fmtMonth(performance.last_loaded)} ${performance.year}: ${php(performance.ytd_actual)} vs target ${php(performance.ytd_target)} (${(ach * 100).toFixed(1)}%). Gap ${php(gap)}. FY target ${php(performance.fy_target)}.${performance.month_target != null ? ` This month's target ${php(performance.month_target)}.` : ""}`,
        default_why: `The dealer is ${php(gap)} behind the TTA target to date.`,
        default_action: `Agree a month-by-month order plan with the owner to close the ${php(gap)} gap.`,
      });
    }
  }

  // 4. Projects: the same project in 2+ visits still open, then other open ones.
  const seen = new Map<string, { r: Row; count: number; first: string }>();
  for (const f of fcrs) {
    for (const r of rows(f.form_data, "project_opportunities")) {
      const k = str(r.project_name_owner).toLowerCase();
      if (!k) continue;
      const e = seen.get(k) || { r, count: 0, first: f.visit_date };
      e.count += 1;
      e.first = f.visit_date;
      seen.set(k, e);
    }
  }
  let pn = 0;
  for (const e of [...seen.values()].filter((p) => projectOpen(p.r.status)).sort((a, b) => b.count - a.count).slice(0, 3)) {
    pn += 1;
    const amt = num(e.r.amount);
    const stalled = e.count >= 2;
    out.push({
      category: "Project", score: stalled ? 55 + Math.min(e.count, 6) * 5 : 45 + (amt && amt >= 1_000_000 ? 5 : 0),
      title: `${str(e.r.project_name_owner)}${amt ? ` (${php(amt)})` : ""}: ${str(e.r.status) || "no status"}${stalled ? `, in ${e.count} visits since ${fmtDate(e.first)}` : ""}`,
      fact: `Project ${pn}${amt ? `, ${php(amt)}` : ""}, status "${scrub(e.r.status) || "none"}", reported in ${e.count} visit(s) since ${e.first}. Roll-out: "${scrub(e.r.rollout)}". Last next step: "${scrub(e.r.next_steps)}".`,
      default_why: stalled ? "It keeps coming back without a decision; competitors may be closing it." : "An open project is the fastest route to incremental orders.",
      default_action: stalled ? "Ask the owner for the decision date and the competing offer; bring the RSM if price support is needed." : "Confirm the next step and the decision date at the next contact.",
    });
  }

  if (latest) {
    // 5. CMIP program items with an open next step.
    for (const r of rows(latest.form_data, "program_execution")
      .filter((x) => str(x.next_steps) && !/completed|not applicable/i.test(str(x.status))).slice(0, 2)) {
      out.push({
        category: "Program", score: 35,
        title: `${str(r.program)}: ${str(r.next_steps)}${str(r.status) ? ` (${str(r.status)})` : ""}`,
        fact: `CMIP program "${str(r.program)}" status "${scrub(r.status) || "none"}"; open next step: "${scrub(r.next_steps)}".`,
        default_why: "Programs the dealer has started build loyalty only when finished.",
        default_action: `Complete the next step: ${str(r.next_steps)}.`,
      });
    }
  }

  // 6. Competitor programs seen in the last two visits.
  const brands = new Set<string>();
  for (const f of fcrs.slice(0, 2)) {
    for (const r of rows(f.form_data, "competitive_check")) {
      const b = str(r.brand);
      const detail = [str(r.initiative), str(r.mechanics)].filter(Boolean).join(", ");
      if (!b || !detail || brands.has(b.toLowerCase())) continue;
      brands.add(b.toLowerCase());
      out.push({
        category: "Competitor", score: 50,
        title: `${b} on ${fmtDate(f.visit_date)}: ${detail}`,
        fact: `Competitor ${b} seen ${f.visit_date}: "${scrub(detail)}"${str(r.duration) ? `, duration "${scrub(r.duration)}"` : ""}.`,
        default_why: `${b}'s program can take share of this dealer's orders.`,
        default_action: `Check whether ${b}'s program is still running and answer it with an existing CMIP program.`,
      });
    }
  }

  // 7. Recency.
  if (latest) {
    const days = daysBetween(latest.visit_date, today);
    if (days > 30) {
      out.push({
        category: "Visit", score: 30 + Math.min(Math.round((days - 30) / 2), 40),
        title: `Last approved visit ${days} days ago (${fmtDate(latest.visit_date)})`,
        fact: `Last approved visit was ${days} days ago.`,
        default_why: "Accounts left unvisited drift to the brands that do visit.",
        default_action: "Schedule a visit this week.",
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((c, i) => ({ ...c, ref: `C${i + 1}` }));
}

// ---------------------------------------------------------------------------
// Facts for the model
// ---------------------------------------------------------------------------

export function buildFacts(inp: Inputs, candidates: Candidate[]) {
  const scrub = makeScrubber(inp.account, inp.fcrs);
  const a = inp.account;
  const visits = inp.fcrs.slice(0, 3).map((f) => ({
    date: f.visit_date,
    coverage_notes: scrub(f.form_data?.coverage_notes),
    programs: rows(f.form_data, "program_execution")
      .filter((r) => str(r.status) || str(r.next_steps))
      .map((r) => `${str(r.program)}: ${scrub(r.status) || "no status"}${str(r.next_steps) ? `; next: ${scrub(r.next_steps)}` : ""}`),
    sub_dealer_program: rows(f.form_data, "sub_dealers_program")
      .filter((r) => filled(r, ["pro_shop", "midea_club", "trainings", "marketing_materials", "next_steps"]))
      .map((r, i) => `Sub-dealer ${i + 1}: Pro Shop ${scrub(r.pro_shop) || "-"}, Midea Club ${scrub(r.midea_club) || "-"}, trainings ${scrub(r.trainings) || "-"}${str(r.next_steps) ? `, next: ${scrub(r.next_steps)}` : ""}`),
  }));
  const p = inp.performance;
  return {
    today: inp.today,
    account: {
      type: a.account_type === "sub_dealer" ? "sub-dealer" : "dealer",
      classification: str(a.dealer_classification) || null,
      channel: a.account_type === "sub_dealer" ? null : str(a.channel) || null,
      region: str(a.region) || null,
      priority: str(a.priority) || null,
      payment_terms: str(a.payment_terms) || null,
      credit_limit: num(a.credit_limit) != null ? php(num(a.credit_limit)) : null,
      sub_dealers_on_record: inp.subDealerCount,
    },
    performance: p && p.last_loaded ? {
      year: p.year,
      ytd_through: fmtMonth(p.last_loaded),
      ytd_actual: php(p.ytd_actual),
      ytd_target: php(p.ytd_target),
      achievement_pct: p.ytd_target ? Math.round((p.ytd_actual / p.ytd_target) * 1000) / 10 : null,
      fy_target: php(p.fy_target),
      this_month_target: p.month_target != null ? php(p.month_target) : null,
      last_3_months: p.months.filter((m) => m.month <= p.last_loaded!).slice(-3)
        .map((m) => `${fmtMonth(m.month)}: actual ${php(m.actual ?? 0)} vs target ${php(m.target ?? 0)}`),
    } : null,
    priorities: candidates.map((c) => ({ ref: c.ref, category: c.category, fact: c.fact })),
    recent_visits: visits,
    cmip_programs: CMIP_PROGRAMS,
  };
}

export const SYSTEM_PROMPT = `You advise the ACS sales team of Concepcion Midea Inc. (CMIP), the exclusive distributor of Midea air conditioners in the Philippines. ACS sells residential and light-commercial air conditioners (split / high wall, light commercial, window) through dealers and their sub-dealers. Key Account Managers (KAMs) visit the dealers; Regional Sales Managers (RSMs) supervise the KAMs and approve their visit reports.

You receive the facts about ONE account as JSON. Customer, people and project names are removed on purpose; refer to "the dealer", "the owner", "Project 1".

Rules:
- Use only the facts given. Never invent amounts, dates, promotions, prices or programs. Mention only CMIP programs listed in cmip_programs or in the facts.
- Amounts are Philippine pesos; write them as given (PHP 1,234,567).
- Plain, direct English a busy KAM can act on today. One sentence per field, under 30 words. No greetings, no emojis, no markdown.

Return JSON:
- summary: one sentence on where the account stands.
- priorities: for EVERY item in facts.priorities, keep its ref and write "why" (why it matters now) and "action" (the concrete next step, with the date when one is given).
- kam: 2 or 3 actions for the KAM to develop this account and get it to buy more Midea (close the gap to target, move stalled projects, answer competitor programs with CMIP programs, activate sub-dealers, training, display and stock).
- rsm: 1 or 2 actions for the RSM (coach the KAM, join a visit, escalate collection or pricing, follow up overdue promises).`;

export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    priorities: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { ref: { type: "STRING" }, why: { type: "STRING" }, action: { type: "STRING" } },
        required: ["ref", "why", "action"],
      },
    },
    kam: { type: "ARRAY", items: { type: "STRING" } },
    rsm: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "priorities", "kam", "rsm"],
};

// ---------------------------------------------------------------------------
// Rules-only advice (no AI) and merging the model's answer
// ---------------------------------------------------------------------------

export function rulesInsights(inp: Inputs, candidates: Candidate[], note?: string): Insights {
  const p = inp.performance;
  const gap = p && p.last_loaded && p.ytd_target > 0 ? p.ytd_target - p.ytd_actual : null;
  const ach = p && p.ytd_target > 0 && p.last_loaded ? p.ytd_actual / p.ytd_target : null;
  const overdue = candidates.filter((c) => c.category === "Get-back" && (c.overdue_days || 0) > 0).length;
  const competitor = candidates.find((c) => c.category === "Competitor");
  const stalled = candidates.find((c) => c.category === "Project");

  const kam: string[] = [];
  if (gap != null && gap > 0) kam.push(`Agree a month-by-month order plan with the owner to close the ${php(gap)} gap to the target to date.`);
  if (stalled) kam.push("Push the open project to a decision: confirm the decision date, the competing offer and what Midea must match.");
  if (competitor) kam.push(`Answer ${competitor.title.split(" on ")[0]}'s program with an existing CMIP program the dealer has not used yet.`);
  if (inp.account.account_type === "dealer" && !inp.subDealerCount) kam.push("Map the dealer's sub-dealers and enroll the active ones in Midea Club and Pro Shop.");
  if (kam.length < 2) kam.push("Check display, stock and product training at the store, and close gaps before the next order.");

  const rsm: string[] = [];
  if (overdue > 0) rsm.push(`Review the ${overdue} overdue get-back item${overdue === 1 ? "" : "s"} with the KAM this week and agree firm dates.`);
  if (ach != null && ach < 0.8) rsm.push("Join the next visit to agree the order plan with the owner.");
  if (candidates.some((c) => c.category === "Collection" && (c.overdue_days || 0) > 0)) rsm.push("Escalate the missed AR commitment with Credit and Collection before approving new credit.");
  if (!rsm.length) rsm.push("Review this account's priorities with the KAM at the weekly meeting.");

  const summary = ach != null
    ? `Sales are ${(ach * 100).toFixed(0)}% of target to ${fmtMonth(p!.last_loaded)}, with ${candidates.length} open priorit${candidates.length === 1 ? "y" : "ies"}.`
    : `${candidates.length} open priorit${candidates.length === 1 ? "y" : "ies"} from the approved visit reports.`;

  return {
    summary,
    priorities: candidates.map((c) => ({
      ref: c.ref, category: c.category, title: c.title, why: c.default_why, action: c.default_action,
      due_date: c.due_date ?? null, overdue_days: c.overdue_days ?? null, get_back_id: c.get_back_id ?? null,
    })),
    develop: { kam: kam.slice(0, 3), rsm: rsm.slice(0, 2) },
    as_of: inp.today,
    ...(note ? { note } : {}),
  };
}

const clean = (v: unknown, max = 300) => {
  const s = str(v).replace(/\s+/g, " ").replace(/[*_#`]/g, "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

// The model's words over the rules' list. Refs the model skipped or invented
// fall back to the rules' text; the order is always the rules' order.
export function mergeModel(base: Insights, model: unknown): Insights {
  const m = (model && typeof model === "object" ? model : {}) as Record<string, unknown>;
  const byRef = new Map<string, Record<string, unknown>>();
  if (Array.isArray(m.priorities)) {
    for (const p of m.priorities as Record<string, unknown>[]) if (p && typeof p.ref === "string") byRef.set(p.ref, p);
  }
  const list = (v: unknown, n: number) =>
    Array.isArray(v) ? (v as unknown[]).map((x) => clean(x)).filter(Boolean).slice(0, n) : [];
  const kam = list(m.kam, 3);
  const rsm = list(m.rsm, 2);
  return {
    ...base,
    summary: clean(m.summary) || base.summary,
    priorities: base.priorities.map((p) => {
      const x = byRef.get(p.ref);
      return { ...p, why: clean(x?.why) || p.why, action: clean(x?.action) || p.action };
    }),
    develop: { kam: kam.length ? kam : base.develop.kam, rsm: rsm.length ? rsm : base.develop.rsm },
  };
}

// Performance from target and DSR rows (same definitions as lib/targets.js:
// YTD runs January through the last month with a final DSR; a loaded month
// without a row means zero sales, not unknown).
export function performanceFrom(
  year: number, today: string,
  targets: { month: string; target_amount: number | string }[],
  actuals: { month: string; actual_sales: number | string }[],
  loadedMonths: string[],
): Performance | null {
  if (!targets.length) return null;
  const loaded = new Set(loadedMonths.map((m) => String(m).slice(0, 10)));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    const t = targets.find((r) => String(r.month).slice(0, 10) === m);
    const s = actuals.find((r) => String(r.month).slice(0, 10) === m);
    return { month: m, target: t ? Number(t.target_amount) : null, actual: s ? Number(s.actual_sales) : loaded.has(m) ? 0 : null };
  });
  const lastLoaded = [...loaded].filter((m) => m.startsWith(String(year))).sort().at(-1) || null;
  const upTo = months.filter((m) => lastLoaded && m.month <= lastLoaded);
  return {
    year,
    last_loaded: lastLoaded,
    month_target: months.find((m) => m.month === `${today.slice(0, 7)}-01`)?.target ?? null,
    fy_target: months.reduce((s, m) => s + (m.target || 0), 0),
    ytd_target: upTo.reduce((s, m) => s + (m.target || 0), 0),
    ytd_actual: upTo.reduce((s, m) => s + (m.actual || 0), 0),
    months,
  };
}
