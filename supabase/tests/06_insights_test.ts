// Unit tests for the rules and scrubbing behind account-insights (fake data).
//   deno test supabase/tests/06_insights_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type Inputs, buildCandidates, buildFacts, makeScrubber, mergeModel, performanceFrom, rulesInsights,
} from "../functions/_shared/insights.ts";

const today = "2026-10-27";
const perf = performanceFrom(2026, today,
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}-01`, target_amount: 1_000_000 })),
  [{ month: "2026-01-01", actual_sales: 900_000 }, { month: "2026-02-01", actual_sales: 500_000 }],
  ["2026-01-01", "2026-02-01", "2026-03-01"]);

const inputs: Inputs = {
  today,
  account: {
    id: "a1", account_type: "dealer", company_name: "ZZ Coolair Trading", owners: "Juan Dela Cruz",
    contact_person: "Maria Santos", region: "NCR", dealer_classification: "Key Dealer", channel: "Traditional",
    payment_terms: "30 days", credit_limit: 2_000_000, bp_code: "ZZ1",
  },
  fcrs: [
    {
      id: "f2", visit_date: "2026-10-10", attendee_name: "Maria Santos",
      form_data: {
        coverage_notes: "Met Maria Santos (0917 123 4567, maria@coolair.ph). ZZ Coolair Trading wants better LC pricing.",
        ar_collection: { f: {}, rows: [{ amount: "250000", reason: "Waiting for customer payment", commitment_date: "2026-10-20" }] },
        project_opportunities: { f: {}, rows: [{ project_name_owner: "Sta. Rosa Mall - Mr. Lim", amount: "3500000", status: "Quoted", next_steps: "Revise BOQ" }] },
        competitive_check: { f: {}, rows: [{ brand: "Daikin", initiative: "Free installation", mechanics: "2 units and up" }] },
        program_execution: { f: {}, rows: [{ program: "Product Training", status: "In progress", next_steps: "Schedule LC training" }] },
      },
    },
    {
      id: "f1", visit_date: "2026-09-15", attendee_name: "Juan Dela Cruz",
      form_data: {
        project_opportunities: { f: {}, rows: [{ project_name_owner: "Sta. Rosa Mall - Mr. Lim", amount: "3500000", status: "Inquiry" }] },
      },
    },
  ],
  getBacks: [
    { id: "g1", item: "Send revised LC price list to Juan Dela Cruz", due_date: "2026-10-15", promised_on: "2026-10-10" },
    { id: "g2", item: "Brochures", due_date: null, promised_on: "2026-10-25" },
    { id: "g3", item: "Christmas promo", due_date: "2026-12-20", promised_on: "2026-10-10" },
  ],
  performance: perf,
  subDealerCount: 0,
};

Deno.test("performance: YTD runs to the last loaded month; loaded month without sales is zero", () => {
  assertEquals(perf!.last_loaded, "2026-03-01");
  assertEquals(perf!.ytd_target, 3_000_000);
  assertEquals(perf!.ytd_actual, 1_400_000);
  assertEquals(perf!.months[2].actual, 0);
  assertEquals(perf!.months[3].actual, null);
  assertEquals(perf!.month_target, 1_000_000);
});

Deno.test("rules: overdue promise first, far-future promise left out, order by score", () => {
  const c = buildCandidates(inputs);
  assertEquals(c[0].category, "Get-back");
  assertEquals(c[0].get_back_id, "g1");
  assertEquals(c[0].overdue_days, 12);
  assert(!c.some((x) => x.get_back_id === "g3"), "Dec promise is not a priority yet");
  assert(c.some((x) => x.category === "Collection" && x.overdue_days === 7));
  assert(c.some((x) => x.category === "Sales gap"));
  assert(c.some((x) => x.category === "Project" && x.title.includes("in 2 visits")));
  assert(c.length <= 6);
  for (let i = 1; i < c.length; i++) assert(c[i - 1].score >= c[i].score, "sorted by score");
  assertEquals(c.map((x) => x.ref), c.map((_, i) => `C${i + 1}`));
});

Deno.test("scrubbing: no names, phones, emails or project names reach the model", () => {
  const c = buildCandidates(inputs);
  const sent = JSON.stringify(buildFacts(inputs, c));
  for (const secret of ["Juan", "Maria", "Santos", "Coolair", "0917", "maria@", "Sta. Rosa", "Lim"]) {
    assert(!sent.includes(secret), `"${secret}" leaked: ${sent}`);
  }
  assert(sent.includes("[customer]"));
  assert(sent.includes("Daikin"), "competitor brands stay");
  assert(sent.includes("Project 1"));
  // The screen keeps the real names.
  assert(c.some((x) => x.title.includes("Juan Dela Cruz")));
});

Deno.test("scrubber: landline and long numbers", () => {
  const s = makeScrubber(inputs.account, []);
  assertEquals(s("Call (02) 8123-4567 or +63 917 555 1234, ref 123456789"), "Call [phone] or [phone], ref [number]");
  assertEquals(s("PHP 1,250,000 order"), "PHP 1,250,000 order");
});

Deno.test("rules-only advice covers KAM and RSM", () => {
  const r = rulesInsights(inputs, buildCandidates(inputs));
  assert(r.develop.kam.length >= 2 && r.develop.kam.length <= 3);
  assert(r.develop.rsm.length >= 1 && r.develop.rsm.length <= 2);
  assert(r.develop.kam[0].includes("PHP 1,600,000"));
  assert(r.develop.rsm.some((x) => x.includes("overdue get-back")));
});

Deno.test("merge: model text over rules list; unknown refs ignored; missing refs keep rules text", () => {
  const c = buildCandidates(inputs);
  const base = rulesInsights(inputs, c);
  const m = mergeModel(base, {
    summary: "Behind target with an **overdue** promise.",
    priorities: [{ ref: "C1", why: "Trust.", action: "Send it today." }, { ref: "C99", why: "x", action: "y" }],
    kam: ["Plan orders.", "", "Train staff.", "Extra", "More"],
    rsm: [],
  });
  assertEquals(m.summary, "Behind target with an overdue promise.");
  assertEquals(m.priorities.length, base.priorities.length);
  assertEquals(m.priorities[0].action, "Send it today.");
  assertEquals(m.priorities[1].action, base.priorities[1].action);
  assertEquals(m.develop.kam, ["Plan orders.", "Train staff.", "Extra"]);
  assertEquals(m.develop.rsm, base.develop.rsm);
  assertEquals(mergeModel(base, "garbage").priorities, base.priorities);
});

Deno.test("empty account: no FCRs, no targets", () => {
  const empty: Inputs = { ...inputs, fcrs: [], getBacks: [], performance: null, subDealerCount: null, account: { ...inputs.account, account_type: "sub_dealer" } };
  const c = buildCandidates(empty);
  assertEquals(c.length, 0);
  const r = rulesInsights(empty, c);
  assert(r.develop.kam.length >= 1);
  assert(r.summary.length > 0);
});

Deno.test("monthly dip: ahead for the year but the last month fell short", () => {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}-01`, target_amount: 1_000_000 }));
  const actuals = [1, 2, 3, 4, 5, 6, 7, 8].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}-01`, actual_sales: 1_300_000 }))
    .concat([{ month: "2026-09-01", actual_sales: 600_000 }]);
  const loaded = months.slice(0, 9).map((m) => m.month);
  const p = performanceFrom(2026, today, months, actuals, loaded)!;
  assert(p.ytd_actual / p.ytd_target > 1, "ahead for the year");
  const inp: Inputs = { ...inputs, fcrs: [], getBacks: [], performance: p };
  const c = buildCandidates(inp);
  assertEquals(c.length, 1);
  assertEquals(c[0].category, "Sales gap");
  assert(c[0].title.startsWith("September sales 60% of target (PHP 400,000 short)"), c[0].title);
  const r = rulesInsights(inp, c);
  assert(r.develop.kam[0].includes("September"), r.develop.kam[0]);
  assert(r.develop.rsm.some((x) => x.includes("September")));
  // A good last month: nothing.
  const ok = performanceFrom(2026, today, months, actuals.slice(0, 8).concat([{ month: "2026-09-01", actual_sales: 900_000 }]), loaded);
  assertEquals(buildCandidates({ ...inp, performance: ok }).length, 0);
});

Deno.test("monthly dip is not added when the YTD gap is already on the list", () => {
  const c = buildCandidates(inputs); // YTD 47%, March = 0 sales
  assertEquals(c.filter((x) => x.category === "Sales gap").length, 1);
});
