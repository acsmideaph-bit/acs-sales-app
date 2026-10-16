import { fmt, todayYmd } from './dates'
import { templateFor, filledRows, sectionHasContent, peso, columnTotal, matrixCell } from './fcrTemplates'

// Builds the Minutes of the Meeting from an FCR. ONE function, used by the
// FCR preview, the public acknowledgement page and the PDF, so what the
// customer confirms is exactly what is archived.
//
// Neither ACS paper form has a "minutes" section; the minutes are a
// customer-facing summary of what was discussed and agreed: program
// execution, competitive notes, AR commitments, projects, sub-dealer program,
// get-back items and coverage notes. Internal sales targets are summarised,
// not itemised; the official account target vs actual is stated in totals.
//
// Returns { heading, meta: [[label, value]], blocks: [{title, lines[]}] }.
export function buildMinutes({ fcr, submitterName, submitterPosition }) {
  const t = templateFor(fcr.template_id, fcr.template_version)
  const fd = fcr.form_data || {}
  const ci = fcr.customer_info || {}
  const sec = (k) => t.sections.find((s) => s.key === k)
  const blocks = []

  const pe = sec('program_execution')
  if (pe && sectionHasContent(pe, fd[pe.key])) {
    const lines = filledRows(pe, fd[pe.key])
      .filter((r) => r.status || r.next_steps || r.notes || r.date)
      .map((r) => [
        r.program,
        r.status && `status: ${r.status}`,
        r.date && `date: ${fmt(r.date)}`,
        r.next_steps && `next: ${r.next_steps}`,
        r.notes,
      ].filter(Boolean).join(' - '))
    if (lines.length) blocks.push({ title: 'CMIP Program Execution', lines })
  }

  const cc = sec('competitive_check')
  if (cc) {
    const lines = filledRows(cc, fd[cc.key]).map((r) =>
      [r.brand || 'Other brand', r.initiative, r.duration && `(${r.duration})`, r.mechanics, r.notes].filter(Boolean).join(' - '))
    if (lines.length) blocks.push({ title: 'Competitive Activity Noted', lines })
  }

  const ar = sec('ar_collection')
  if (ar && sectionHasContent(ar, fd[ar.key])) {
    const v = fd[ar.key]
    const lines = []
    if (v.f?.payment_terms) lines.push(`Payment terms: ${v.f.payment_terms}`)
    if (v.f?.credit_limit) lines.push(`Credit limit: PHP ${peso(v.f.credit_limit)}`)
    filledRows(ar, v).forEach((r) => lines.push(
      [r.amount && `PHP ${peso(r.amount)} overdue`, r.reason, r.commitment_date && `committed to settle by ${fmt(r.commitment_date)}`, r.next_steps, r.contact && `contact: ${r.contact}`].filter(Boolean).join(' - ')))
    const total = columnTotal(v, 'amount')
    if (total) lines.push(`Total overdue discussed: PHP ${peso(total)}`)
    blocks.push({ title: 'AR and Collection', lines })
  }

  // Official target vs actual (TTA plan + final DSR, by BP code). Part of what
  // the dealer confirms, so the minutes state the same figures as the form.
  const ap = sec('account_performance')
  const snap = ap ? fd[ap.key] : null
  if (snap?.bp_code) {
    const php = (n) => `PHP ${peso(Math.round(n || 0))}`
    const mon = (m) => fmt(m, 'MMMM yyyy')
    const lines = [`FY ${snap.year} TTA target: ${php(snap.fy_target)} (BP code ${snap.bp_code})`]
    if (snap.month_target != null) lines.push(`Target for ${mon(snap.visit_month)}: ${php(snap.month_target)}; ${snap.quarter} target: ${php(snap.quarter_target)}`)
    if (snap.as_of) {
      const a = snap.ytd_target ? ` (${((snap.ytd_actual / snap.ytd_target) * 100).toFixed(1)}% of target ${php(snap.ytd_target)})` : ''
      lines.push(`Actual RAC and LC sales January to ${fmt(snap.as_of, 'MMMM yyyy')}, per final DSR: ${php(snap.ytd_actual)}${a}`)
      const gap = (snap.ytd_target || 0) - (snap.ytd_actual || 0)
      if (gap > 0) lines.push(`Balance to reach the target to date: ${php(gap)}`)
    } else {
      lines.push('Actual sales: no final DSR loaded yet for this year')
    }
    blocks.push({ title: 'Sales Performance (Official)', lines })
  }

  const tta = sec('tta_trip')
  if (tta && filledRows(tta, fd[tta.key]).some((r) => r.pax || r.target)) {
    const lines = filledRows(tta, fd[tta.key]).filter((r) => r.pax || r.target).map((r) =>
      `${r.trip}: ${r.pax ? `${r.pax} pax` : ''}${r.target ? ` - target PHP ${peso(r.target)}` : ''}`)
    blocks.push({ title: 'TTA Trip Goal', lines })
  }

  for (const key of ['product_targets', 'sell_through']) {
    const m = sec(key)
    if (m && sectionHasContent(m, fd[key])) {
      const v = fd[key]
      const lines = []
      for (const g of m.groups) {
        const parts = m.metrics.map((mt) => {
          const totalCol = m.columns.find((c) => c.computed && c.computed.length >= 3 && (c.key === 'qtr' || c.key === 'half'))
          const val = totalCol ? matrixCell(m, v, g, mt.key, totalCol.key) : null
          return val != null ? `${mt.label} ${peso(val)}` : null
        }).filter(Boolean)
        if (parts.length) lines.push(`${g} (${v.period}): ${parts.join(', ')}`)
      }
      if (lines.length) blocks.push({ title: m.title.replace('Sales Update - ', 'Sales Update: '), lines })
    }
  }

  const po = sec('project_opportunities')
  if (po) {
    const lines = filledRows(po, fd[po.key]).map((r) =>
      [r.project_name_owner || 'Project', r.address, r.amount && `PHP ${peso(r.amount)}`, r.rollout && `roll-out ${r.rollout}`, r.consultant && `consultant ${r.consultant}`, r.status, r.next_steps && `next: ${r.next_steps}`].filter(Boolean).join(' - '))
    if (lines.length) blocks.push({ title: 'Project Opportunities Under Negotiation', lines })
  }

  const sd = sec('sub_dealers_program')
  if (sd) {
    const lines = filledRows(sd, fd[sd.key]).map((r) =>
      [r.client_name || 'Sub-dealer', r.pro_shop && `Pro Shop: ${r.pro_shop}`, r.midea_club && `Midea Club: ${r.midea_club}`, r.trainings && `Trainings: ${r.trainings}`, r.marketing_materials && `Materials: ${r.marketing_materials}`, r.next_steps && `next: ${r.next_steps}`].filter(Boolean).join(' - '))
    if (lines.length) blocks.push({ title: 'Sub-Dealers Program', lines })
  }

  const ci4 = sec('cycle_initiatives')
  if (ci4) {
    const lines = filledRows(ci4, fd[ci4.key]).filter((r) => r.initiative || r.notes).map((r) => `${r.quarter}: ${[r.initiative, r.notes].filter(Boolean).join(' - ')}`)
    if (lines.length) blocks.push({ title: 'Cycle Initiatives', lines })
  }

  const gb = String(fd.get_back_items || '').trim()
  blocks.push({ title: 'Agreed Get-Back Items', lines: gb ? gb.split(/\n+/).map((l) => l.trim()).filter(Boolean) : ['None recorded.'] })

  const cn = String(fd.coverage_notes || '').trim()
  blocks.push({ title: 'Coverage Notes', lines: cn ? cn.split(/\n+/).map((l) => l.trim()).filter(Boolean) : ['None recorded.'] })

  const meta = [
    ['Company', ci.company_name || 'Not specified'],
    ['Visit date', `${fmt(fcr.visit_date || todayYmd(), 'MMMM d, yyyy')} (${fcr.period === 'PM' ? 'afternoon' : 'morning'})`],
    ['Location', ci.business_address || 'Not specified'],
    ['Concepcion Midea', `${submitterName || 'Not specified'}${submitterPosition ? `, ${submitterPosition}` : ''}`],
    ['Customer attendee', `${fcr.attendee_name || 'Not specified'}${fcr.attendee_designation ? `, ${fcr.attendee_designation}` : ''}`],
  ]

  return { heading: 'Minutes of the Meeting', meta, blocks, templateTitle: t.title }
}

export const minutesToText = (m) => [
  m.heading.toUpperCase(),
  '',
  ...m.meta.map(([k, v]) => `${k}: ${v}`),
  '',
  ...m.blocks.flatMap((b) => [b.title.toUpperCase(), ...b.lines.map((l) => `- ${l}`), '']),
  'By confirming, the customer attendee agrees this summary accurately reflects the meeting.',
].join('\n')
