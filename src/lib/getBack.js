import { differenceInCalendarDays, addDays } from 'date-fns'
import { supabase, rpc, invokeFunction } from './supabase'
import { toDate, todayYmd, ymd } from './dates'

// Tracked get-back items (table get_back_items, opened when an FCR is
// approved) and the account-insights Edge Function. Reads are RLS-scoped;
// status changes go through set_get_back_status, which allows the KAM who
// promised, the account's current KAM, or the direct superior (RSM) of either.

export async function fetchGetBacks({ accountId, status, limit = 500 } = {}) {
  let q = supabase.from('get_back_items')
    .select('*, account:accounts(id, company_name, kam_id)')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('promised_on', { ascending: true })
    .limit(limit)
  if (accountId) q = q.eq('account_id', accountId)
  if (status === 'open') q = q.eq('status', 'open')
  else if (status === 'closed') q = q.neq('status', 'open')
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export const setGetBackStatus = (id, status, note = null) => rpc('set_get_back_status', { p_id: id, p_status: status, p_note: note })

// Older forms had no due date: treat it as one week after the visit, the same
// assumption the insights rules make.
export const effectiveDue = (g) => g.due_date || (g.promised_on ? ymd(addDays(toDate(g.promised_on), 7)) : null)

export const daysOverdue = (g, today = todayYmd()) => {
  const due = effectiveDue(g)
  if (!due || g.status !== 'open') return 0
  return Math.max(0, differenceInCalendarDays(toDate(today), toDate(due)))
}

// Who sees the Done / Drop buttons. The database decides; this only avoids
// showing buttons that would be refused.
export const canActOnGetBack = (g, { userId, byId, accountKamId, canWrite }) => {
  if (!canWrite || !g) return false
  const owner = byId[g.owner_id]
  const kam = accountKamId ? byId[accountKamId] : null
  return g.owner_id === userId || accountKamId === userId || owner?.supervisor_id === userId || kam?.supervisor_id === userId
}

export async function fetchInsights(accountId, refresh = false) {
  const res = await invokeFunction('account-insights', { account_id: accountId, refresh })
  if (!res?.ok) throw new Error(res?.error || 'Could not load the priorities')
  return res.insights
}

export const notifyGetBackChanged = () => window.dispatchEvent(new Event('acs:getback-changed'))
