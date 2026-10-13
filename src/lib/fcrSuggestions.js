import { differenceInCalendarDays } from 'date-fns'
import { fmt, toDate } from './dates'
import { templateFor, filledRows, peso } from './fcrTemplates'

// "Suggested discussion points" for the next visit, built from the account's
// own past FCRs. This is a transparent rule-based pass over data the KAM
// already entered -- NOT generative AI -- and the UI says so.
//
// pastFcrs: most-recent-first, each { visit_date, template_id, template_version, form_data }
const CLOSED = ['delivered', 'po received', 'lost', 'won']
const isOpen = (s) => {
  const v = String(s || '').trim().toLowerCase()
  return !CLOSED.some((c) => v.includes(c))
}

export function buildSuggestions(pastFcrs = [], today = new Date()) {
  const out = []
  const push = (category, text) => out.push({ id: `${category}-${out.length}`, category, text })
  if (!pastFcrs.length) return out
  const latest = pastFcrs[0]
  const sectionOf = (fcr, key) => templateFor(fcr.template_id, fcr.template_version).sections.find((s) => s.key === key)

  // 1. Get-back items promised last time.
  const gb = String(latest.form_data?.get_back_items || '').trim()
  if (gb) push('Follow up', `Promised on ${fmt(latest.visit_date)}: "${gb.split('\n')[0]}${gb.includes('\n') ? '…' : ''}"`)

  // 2. AR commitments now due or overdue.
  const ar = sectionOf(latest, 'ar_collection')
  if (ar) {
    filledRows(ar, latest.form_data?.ar_collection).forEach((r) => {
      if (r.commitment_date && toDate(r.commitment_date) <= today) {
        push('Collection', `PHP ${peso(r.amount) || '—'} was committed for ${fmt(r.commitment_date)}${r.reason ? ` (${r.reason})` : ''}. Confirm payment.`)
      }
    })
  }

  // 3. Program execution items with next steps still open.
  const pe = sectionOf(latest, 'program_execution')
  if (pe) {
    filledRows(pe, latest.form_data?.program_execution)
      .filter((r) => r.next_steps && !/completed|not applicable/i.test(r.status || ''))
      .slice(0, 2)
      .forEach((r) => push('Program', `${r.program}: ${r.next_steps}${r.status ? ` (last status: ${r.status})` : ''}`))
  }

  // 4. Projects that keep reappearing without closing.
  const seen = new Map()
  pastFcrs.forEach((f) => {
    const po = sectionOf(f, 'project_opportunities')
    if (!po) return
    filledRows(po, f.form_data?.project_opportunities).forEach((r) => {
      const k = String(r.project_name_owner || '').trim().toLowerCase()
      if (!k) return
      const e = seen.get(k) || { ...r, count: 0, first: f.visit_date }
      e.count += 1
      e.first = f.visit_date
      seen.set(k, e)
    })
  })
  const open = [...seen.values()].filter((p) => isOpen(p.status))
  open.filter((p) => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 2)
    .forEach((p) => push('Project', `"${p.project_name_owner}" has appeared in ${p.count} visits since ${fmt(p.first, 'MMM yyyy')}, still "${p.status || 'no status'}". Push for a decision.`))
  open.filter((p) => p.count < 2).slice(0, 2)
    .forEach((p) => push('Project', `Check "${p.project_name_owner}"${p.status ? ` (${p.status})` : ''}${p.next_steps ? `: ${p.next_steps}` : ''}`))

  // 5. Competitor activity from the last two visits.
  const brands = new Set()
  pastFcrs.slice(0, 2).forEach((f) => {
    const cc = sectionOf(f, 'competitive_check')
    if (!cc) return
    filledRows(cc, f.form_data?.competitive_check).forEach((r) => {
      const b = String(r.brand || '').trim()
      const detail = [r.initiative, r.mechanics].filter(Boolean).join(', ')
      if (b && detail && !brands.has(b.toLowerCase())) {
        brands.add(b.toLowerCase())
        push('Competitor', `${b} on ${fmt(f.visit_date, 'MMM d')}: ${detail}. Check if it is still running.`)
      }
    })
  })

  // 6. Recency.
  const days = differenceInCalendarDays(today, toDate(latest.visit_date))
  if (days > 30) push('Timing', `Last approved visit was ${days} days ago (${fmt(latest.visit_date)}).`)

  return out.slice(0, 7)
}
