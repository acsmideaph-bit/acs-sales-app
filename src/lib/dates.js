import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isValid } from 'date-fns'

// THE week definition for this app: Monday to Sunday. Used by the dashboard,
// weekly report, census and (mirrored) the Friday digest Edge Function.
// MBT mixed Sun-Sat in the UI with Mon-run-date in the digest; don't.
export const WEEK_OPTS = { weekStartsOn: 1 }
export const weekStart = (d = new Date()) => startOfWeek(d, WEEK_OPTS)
export const weekEnd = (d = new Date()) => endOfWeek(d, WEEK_OPTS)

// Date-only strings ('yyyy-MM-dd') must go through parseISO, never
// new Date('yyyy-MM-dd') (that parses as UTC midnight and can shift a day).
export const toDate = (s) => (s instanceof Date ? s : s ? parseISO(s) : null)
export const ymd = (d) => format(toDate(d), 'yyyy-MM-dd')
export const monthKey = (d) => format(toDate(d), 'yyyy-MM-01')
export const monthRange = (d) => ({ start: ymd(startOfMonth(toDate(d))), end: ymd(endOfMonth(toDate(d))) })

export const fmt = (s, pattern = 'MMM d, yyyy') => {
  const d = toDate(s)
  return d && isValid(d) ? format(d, pattern) : ''
}
export const fmtDateTime = (s) => {
  if (!s) return ''
  const d = new Date(s) // timestamptz strings are full ISO, safe here
  return isValid(d) ? format(d, 'MMM d, yyyy h:mm a') : ''
}
export const todayYmd = () => format(new Date(), 'yyyy-MM-dd')

export const monthsBetween = (from, to) => {
  const out = []
  let m = from.slice(0, 7)
  const end = to.slice(0, 7)
  while (m <= end) {
    out.push(`${m}-01`)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  return out
}
