import { supabase } from './supabase'
import { MONTHS } from './targetImport'

// Dealer ownership, targets and official sales. All reads are RLS-scoped: a
// KAM sees the dealers they hold in any month of the year (all 12 months of
// each), superiors see their branch, admins see everything.

export const monthOf = (ymd) => `${String(ymd || '').slice(0, 7)}-01`
export const yearOf = (ymd) => Number(String(ymd || '').slice(0, 4))
export const monthName = (ymd, long = true) => {
  const m = Number(String(ymd).slice(5, 7))
  const y = String(ymd).slice(0, 4)
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return long ? `${names[m - 1]} ${y}` : `${MONTHS[m - 1].charAt(0)}${MONTHS[m - 1].slice(1).toLowerCase()}`
}

// Dealer account ids a user owns in the month of `ymd`, with that month's target.
export async function fetchOwnedDealers(userId, ymd) {
  const { data: t, error } = await supabase.from('account_targets')
    .select('bp_code, target_amount').eq('kam_id', userId).eq('month', monthOf(ymd))
  if (error) throw error
  const codes = (t || []).map((r) => r.bp_code)
  if (!codes.length) return []
  const { data: a, error: e2 } = await supabase.from('accounts').select('id, bp_code').in('bp_code', codes)
  if (e2) throw e2
  const target = Object.fromEntries((t || []).map((r) => [r.bp_code, Number(r.target_amount)]))
  return (a || []).map((x) => ({ account_id: x.id, bp_code: x.bp_code, target: target[x.bp_code] }))
}

// Twelve months of target, owner and actual sales for one dealer.
export async function fetchPerformance(bpCode, year) {
  if (!bpCode || !year) return null
  const from = `${year}-01-01`
  const to = `${year}-12-01`
  const [tg, sa, loaded] = await Promise.all([
    supabase.from('account_targets').select('month, target_amount, kam_label, kam_id').eq('bp_code', bpCode).gte('month', from).lte('month', to),
    supabase.from('sales_actuals').select('month, actual_sales').eq('bp_code', bpCode).gte('month', from).lte('month', to),
    supabase.rpc('sales_months_loaded', { p_year: year }),
  ])
  if (tg.error) throw tg.error
  if (sa.error) throw sa.error
  const loadedSet = new Set((loaded.data || []).map((d) => String(d).slice(0, 10)))
  const months = MONTHS.map((_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}-01`
    const t = (tg.data || []).find((r) => r.month === m)
    const s = (sa.data || []).find((r) => r.month === m)
    return {
      month: m,
      target: t ? Number(t.target_amount) : null,
      kam: t?.kam_label || null,
      kam_id: t?.kam_id || null,
      // Loaded month without a row = no sales that month (0), not unknown.
      actual: s ? Number(s.actual_sales) : loadedSet.has(m) ? 0 : null,
    }
  })
  return { bp_code: bpCode, year, months, lastLoaded: [...loadedSet].sort().at(-1) || null }
}

// Snapshot stored in the FCR (form_data.account_performance). The customer
// acknowledges this exact view, so it is frozen once the request goes out.
export function performanceSnapshot(perf, visitDate) {
  if (!perf) return null
  const vm = monthOf(visitDate)
  const qStart = Math.floor((Number(vm.slice(5, 7)) - 1) / 3) * 3
  const qMonths = perf.months.slice(qStart, qStart + 3)
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const throughLoaded = perf.months.filter((r) => perf.lastLoaded && r.month <= perf.lastLoaded)
  return {
    bp_code: perf.bp_code,
    year: perf.year,
    visit_month: vm,
    as_of: perf.lastLoaded,               // last month with a final DSR
    months: perf.months.map(({ month, target, actual, kam }) => ({ month, target, actual, kam })),
    month_target: perf.months.find((r) => r.month === vm)?.target ?? null,
    quarter: `Q${qStart / 3 + 1}`,
    quarter_target: sum(qMonths, 'target'),
    fy_target: sum(perf.months, 'target'),
    ytd_target: sum(throughLoaded, 'target'),
    ytd_actual: sum(throughLoaded, 'actual'),
  }
}

export const achievement = (actual, target) => (target ? actual / target : null)
export const pct = (v) => (v == null ? '' : `${(v * 100).toFixed(v >= 10 ? 0 : 1)}%`)
