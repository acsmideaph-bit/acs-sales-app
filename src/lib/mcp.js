import { startOfMonth, endOfMonth, addDays, isSameMonth, isAfter, getDay, eachDayOfInterval, format } from 'date-fns'
import { supabase } from './supabase'
import { toDate, ymd, monthRange } from './dates'

// MCP calendar layout: Monday-Friday work weeks (Saturday shown only when a
// visit falls on it). Week 1 is the week containing the 1st.
export function monthWeeks(monthStr, { includeSaturday = false } = {}) {
  const m = toDate(monthStr)
  const first = startOfMonth(m)
  const last = endOfMonth(m)
  const dow = getDay(first)
  let cursor = addDays(first, dow === 0 ? -6 : 1 - dow) // Monday on/before the 1st
  const width = includeSaturday ? 6 : 5
  const weeks = []
  let n = 1
  while (!isAfter(cursor, last)) {
    const days = []
    for (let i = 0; i < width; i++) {
      const d = addDays(cursor, i)
      days.push(isSameMonth(d, m) ? ymd(d) : null)
    }
    if (days.some(Boolean)) weeks.push({ n: n++, days })
    cursor = addDays(cursor, 7)
  }
  return weeks
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const workingDays = (monthStr) =>
  eachDayOfInterval({ start: startOfMonth(toDate(monthStr)), end: endOfMonth(toDate(monthStr)) })
    .filter((d) => getDay(d) >= 1 && getDay(d) <= 5).length

// MCP Actual = FCRs that cleared both gates: customer acknowledged AND the
// direct superior approved. Computed live, never stored (the Archive stores
// snapshots).
export async function fetchActualVisits({ ownerIds, month }) {
  const { start, end } = monthRange(month)
  let q = supabase.from('fcrs')
    .select('id, owner_id, account_id, visit_date, period, customer_info, account:accounts(company_name)')
    .eq('status', 'approved').eq('ack_status', 'acknowledged')
    .gte('visit_date', start).lte('visit_date', end).order('visit_date')
  if (ownerIds) q = q.in('owner_id', ownerIds)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((f) => ({
    id: f.id, owner_id: f.owner_id, account_id: f.account_id, visit_date: f.visit_date, period: f.period,
    company: f.account?.company_name || f.customer_info?.company_name || 'Account',
  }))
}

export async function fetchPlans({ ownerIds, month }) {
  let q = supabase.from('itineraries').select('id, owner_id, status, visits').eq('month', month)
  if (ownerIds) q = q.in('owner_id', ownerIds)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function fetchDailyNotes({ userId, month }) {
  const { start, end } = monthRange(month)
  const { data, error } = await supabase.from('mcp_daily_notes').select('note_date, note')
    .eq('user_id', userId).gte('note_date', start).lte('note_date', end)
  if (error) throw error
  return Object.fromEntries((data || []).map((r) => [r.note_date, r.note]))
}

export async function saveDailyNote({ date, note }) {
  const { data: { user } } = await supabase.auth.getUser()
  const trimmed = String(note || '').trim()
  if (!trimmed) {
    const { error } = await supabase.from('mcp_daily_notes').delete().eq('user_id', user.id).eq('note_date', date)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('mcp_daily_notes')
    .upsert({ user_id: user.id, note_date: date, note: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'user_id,note_date' })
  if (error) throw error
}

// Self-contained snapshot for the Archive: does not depend on accounts or FCRs
// staying unchanged later.
export const buildSnapshot = ({ month, owner, visits, planned, notes }) => ({
  month,
  owner: { id: owner.id, full_name: owner.full_name, position: owner.position || '', team: owner.team || '' },
  visits: visits.map((v) => ({ fcr_id: v.id, visit_date: v.visit_date, period: v.period, company: v.company })),
  planned_count: planned,
  notes,
  generated_at: new Date().toISOString(),
})

// { 'yyyy-MM-dd': { AM: [label], PM: [label] } }
export function byDayPeriod(items, labelOf) {
  const out = {}
  for (const it of items) {
    if (!it.visit_date) continue
    const p = it.period === 'PM' ? 'PM' : 'AM'
    out[it.visit_date] ||= { AM: [], PM: [] }
    out[it.visit_date][p].push(labelOf(it))
  }
  return out
}

export const monthLabel = (m) => format(toDate(m), 'MMMM yyyy')
