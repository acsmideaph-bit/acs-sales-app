import XLSX from 'xlsx-js-style'
import { fmt, fmtDateTime } from './dates'
import { templateFor, filledRows, num, normalizeFormData } from './fcrTemplates'
import { STATUS_LABELS } from './roles'
import { ACK_CHANNEL_LABELS } from './ack'

// Styled Excel exports. One build*Sheet() per tab, plain computed values (not
// live formulas) because every export is regenerated fresh from the database.

const FONT = { name: 'Calibri', sz: 10 }
const S = {
  title: { font: { ...FONT, sz: 14, bold: true } },
  sub: { font: { ...FONT, color: { rgb: '5F5F64' } } },
  head: { font: { ...FONT, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1D1D1F' } }, alignment: { vertical: 'center', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: '000000' } } } },
  cell: (zebra) => ({ font: FONT, alignment: { vertical: 'top', wrapText: true }, fill: zebra ? { fgColor: { rgb: 'F6F6F8' } } : undefined, border: { bottom: { style: 'hair', color: { rgb: 'D1D1D6' } } } }),
  numCell: (zebra) => ({ ...S.cell(zebra), numFmt: '#,##0.00', alignment: { horizontal: 'right', vertical: 'top' } }),
  intCell: (zebra) => ({ ...S.cell(zebra), numFmt: '0', alignment: { horizontal: 'right', vertical: 'top' } }),
  zero: { font: { ...FONT, bold: true, color: { rgb: 'B3261E' } }, alignment: { horizontal: 'right' } },
  note: { font: { ...FONT, italic: true, color: { rgb: '5F5F64' } }, alignment: { wrapText: true } },
}

// cols: [{ header, width, value: (row) => any, type: 'text'|'num'|'int' }]
function sheet(title, subtitle, cols, rows, notes = []) {
  const aoa = [[title], [subtitle], [], cols.map((c) => c.header)]
  rows.forEach((r) => aoa.push(cols.map((c) => { const v = c.value(r); return v == null ? '' : v })))
  if (notes.length) { aoa.push([]); aoa.push(['How to read this report']); notes.forEach((n) => aoa.push([n])) }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = cols.map((c) => ({ wch: c.width || 14 }))
  ws['!freeze'] = { xSplit: 0, ySplit: 4 }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: cols.length - 1 } }) }
  const set = (r, c, s) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].s = s }
  set(0, 0, S.title); set(1, 0, S.sub)
  cols.forEach((c, i) => set(3, i, S.head))
  rows.forEach((row, ri) => cols.forEach((c, ci) => {
    const z = ri % 2 === 1
    const a = XLSX.utils.encode_cell({ r: 4 + ri, c: ci })
    if (!ws[a]) return
    ws[a].s = c.type === 'num' ? S.numCell(z) : c.type === 'int' ? (c.zeroRed && ws[a].v === 0 ? S.zero : S.intCell(z)) : S.cell(z)
  }))
  if (notes.length) {
    const start = 4 + rows.length + 1
    set(start, 0, { font: { ...FONT, bold: true } })
    notes.forEach((_, i) => set(start + 1 + i, 0, S.note))
  }
  return ws
}

const sectionRows = (fcrs, key, map) => fcrs.flatMap((f) => {
  const t = templateFor(f.template_id, f.template_version)
  const s = t.sections.find((x) => x.key === key)
  if (!s) return []
  const fd = normalizeFormData(t, f.form_data)
  return filledRows(s, fd[key]).map((r) => map(f, r, fd[key]))
})

const base = [
  { header: 'Visit Date', width: 11, value: (r) => fmt(r.f.visit_date, 'yyyy-MM-dd') },
  { header: 'KAM', width: 22, value: (r) => r.f.owner_name },
  { header: 'Account', width: 30, value: (r) => r.f.customer_info?.company_name },
]

// fcrs: rows with owner_name, team, reviewer_name added by the caller
export function buildExportWorkbook({ fcrs, archives = [], from, to, scopeLabel }) {
  const wb = XLSX.utils.book_new()
  const period = `${fmt(from)} to ${fmt(to)} · ${scopeLabel} · generated ${fmtDateTime(new Date().toISOString())}`

  // Summary per KAM
  const byKam = new Map()
  fcrs.forEach((f) => {
    const k = f.owner_name || '—'
    const e = byKam.get(k) || { kam: k, team: f.team, total: 0, approved: 0, pending: 0, rejected: 0, draft: 0, accounts: new Set() }
    e.total++; e[f.status === 'pending_approval' ? 'pending' : f.status]++
    e.accounts.add(f.account_id)
    byKam.set(k, e)
  })
  XLSX.utils.book_append_sheet(wb, sheet('FCR Summary by KAM', period, [
    { header: 'KAM', width: 26, value: (r) => r.kam },
    { header: 'Team', width: 12, value: (r) => r.team },
    { header: 'FCRs (acknowledged)', width: 12, type: 'int', value: (r) => r.total },
    { header: 'Approved', width: 10, type: 'int', value: (r) => r.approved },
    { header: 'Pending approval', width: 10, type: 'int', value: (r) => r.pending },
    { header: 'Rejected', width: 10, type: 'int', value: (r) => r.rejected },
    { header: 'Unique accounts', width: 10, type: 'int', value: (r) => r.accounts.size },
  ], [...byKam.values()].sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.kam.localeCompare(b.kam)), [
    'Counts only FCRs acknowledged by the customer within the date range (by visit date).',
    'Approved = also approved by the KAM\'s direct superior; these make up MCP Actual.',
  ]), 'Summary')

  XLSX.utils.book_append_sheet(wb, sheet('Field Contact Reports', period, [
    { header: 'Visit Date', width: 11, value: (f) => fmt(f.visit_date, 'yyyy-MM-dd') },
    { header: 'AM/PM', width: 6, value: (f) => f.period },
    { header: 'KAM', width: 22, value: (f) => f.owner_name },
    { header: 'Team', width: 10, value: (f) => f.team },
    { header: 'Form', width: 12, value: (f) => templateFor(f.template_id, f.template_version).shortTitle },
    { header: 'Account', width: 30, value: (f) => f.customer_info?.company_name },
    { header: 'Region', width: 10, value: (f) => f.customer_info?.region },
    { header: 'Attendee', width: 20, value: (f) => [f.attendee_name, f.attendee_designation].filter(Boolean).join(', ') },
    { header: 'Acknowledged by', width: 20, value: (f) => f.acknowledged_name },
    { header: 'Acknowledged at', width: 17, value: (f) => fmtDateTime(f.acknowledged_at) },
    { header: 'Request sent via', width: 12, value: (f) => ACK_CHANNEL_LABELS[f.ack_channel] || '' },
    { header: 'Sent to', width: 24, value: (f) => f.ack_recipient },
    { header: 'Number/email owner', width: 20, value: (f) => f.ack_recipient_name },
    { header: 'Status', width: 14, value: (f) => STATUS_LABELS[f.status] },
    { header: 'Reviewed by', width: 20, value: (f) => f.reviewer_name },
    { header: 'Review comment', width: 30, value: (f) => f.review_comment },
    { header: 'Get-back items', width: 40, value: (f) => f.form_data?.get_back_items },
    { header: 'Coverage notes', width: 50, value: (f) => f.form_data?.coverage_notes },
  ], fcrs), 'FCRs')

  XLSX.utils.book_append_sheet(wb, sheet('CMIP Program Execution', period, [
    ...base,
    { header: 'Program', width: 26, value: (r) => r.r.program },
    { header: 'Status', width: 14, value: (r) => r.r.status },
    { header: 'Date', width: 11, value: (r) => fmt(r.r.date, 'yyyy-MM-dd') },
    { header: 'Next Steps', width: 34, value: (r) => r.r.next_steps },
    { header: 'Notes', width: 34, value: (r) => r.r.notes },
  ], sectionRows(fcrs, 'program_execution', (f, r) => ({ f, r })).filter((x) => x.r.status || x.r.next_steps || x.r.notes || x.r.date)), 'Programs')

  XLSX.utils.book_append_sheet(wb, sheet('Competitive Check', period, [
    ...base,
    { header: 'Brand', width: 14, value: (r) => r.r.brand },
    { header: 'Initiative', width: 24, value: (r) => r.r.initiative },
    { header: 'Duration', width: 14, value: (r) => r.r.duration },
    { header: 'Mechanics', width: 34, value: (r) => r.r.mechanics },
    { header: 'Notes', width: 30, value: (r) => r.r.notes },
  ], sectionRows(fcrs, 'competitive_check', (f, r) => ({ f, r }))), 'Competitive')

  XLSX.utils.book_append_sheet(wb, sheet('AR and Collection', period, [
    ...base,
    { header: 'Payment Terms', width: 14, value: (r) => r.v.f?.payment_terms },
    { header: 'AR Overdue (PHP)', width: 14, type: 'num', value: (r) => num(r.r.amount) },
    { header: 'Reason', width: 26, value: (r) => r.r.reason },
    { header: 'Commitment Date', width: 12, value: (r) => fmt(r.r.commitment_date, 'yyyy-MM-dd') },
    { header: 'Next Steps', width: 26, value: (r) => r.r.next_steps },
    { header: 'Contact', width: 18, value: (r) => r.r.contact },
  ], sectionRows(fcrs, 'ar_collection', (f, r, v) => ({ f, r, v }))), 'AR')

  XLSX.utils.book_append_sheet(wb, sheet('Project Opportunities', period, [
    ...base,
    { header: 'Project / Owner', width: 28, value: (r) => r.r.project_name_owner },
    { header: 'Address', width: 20, value: (r) => r.r.address },
    { header: 'Amount (PHP)', width: 14, type: 'num', value: (r) => num(r.r.amount) },
    { header: 'Roll-out', width: 10, value: (r) => r.r.rollout },
    { header: 'Consultant', width: 16, value: (r) => r.r.consultant },
    { header: 'Status', width: 14, value: (r) => r.r.status },
    { header: 'Next Steps', width: 30, value: (r) => r.r.next_steps },
  ], sectionRows(fcrs, 'project_opportunities', (f, r) => ({ f, r }))), 'Projects')

  XLSX.utils.book_append_sheet(wb, sheet('Sub-Dealers Program', period, [
    ...base,
    { header: 'Client', width: 24, value: (r) => r.r.client_name },
    { header: 'Pro Shop', width: 10, value: (r) => r.r.pro_shop },
    { header: 'Midea Club', width: 10, value: (r) => r.r.midea_club },
    { header: 'Trainings', width: 14, value: (r) => r.r.trainings },
    { header: 'Marketing Materials', width: 16, value: (r) => r.r.marketing_materials },
    { header: 'Next Steps', width: 30, value: (r) => r.r.next_steps },
  ], sectionRows(fcrs, 'sub_dealers_program', (f, r) => ({ f, r }))), 'Sub-Dealers')

  XLSX.utils.book_append_sheet(wb, sheet('MCP Actual Archive', period, [
    { header: 'Month', width: 10, value: (a) => fmt(a.month, 'yyyy-MM') },
    { header: 'KAM', width: 24, value: (a) => a.snapshot?.owner?.full_name },
    { header: 'Team', width: 10, value: (a) => a.snapshot?.owner?.team },
    { header: 'Approved visits', width: 10, type: 'int', value: (a) => (a.snapshot?.visits || []).length },
    { header: 'Planned visits', width: 10, type: 'int', value: (a) => a.snapshot?.planned_count },
    { header: 'Generated', width: 18, value: (a) => fmtDateTime(a.created_at) },
  ], archives), 'MCP Archive')

  return wb
}

export function buildCensusWorkbook({ weeks, members, counts, from, to }) {
  const wb = XLSX.utils.book_new()
  const cols = [
    { header: 'Team', width: 12, value: (m) => m.team },
    { header: 'Superior', width: 22, value: (m) => m.supervisor_name },
    { header: 'Name', width: 24, value: (m) => m.full_name },
    ...weeks.map((w) => ({ header: `${fmt(w.start, 'MMM d')}–${fmt(w.end, 'MMM d')}`, width: 12, type: 'int', zeroRed: true, value: (m) => counts[m.id]?.[w.start] || 0 })),
    { header: 'Total', width: 9, type: 'int', value: (m) => weeks.reduce((s, w) => s + (counts[m.id]?.[w.start] || 0), 0) },
  ]
  XLSX.utils.book_append_sheet(wb, sheet('Visitation Census', `${fmt(from)} to ${fmt(to)} · weeks run Monday to Sunday`, cols, members, [
    'One count per FCR acknowledged by the customer, by visit date. Zero-activity weeks are shown in red.',
    'Everyone in your branch is listed, including members with no visits.',
  ]), 'Census')
  return wb
}

export const saveWorkbook = (wb, name) => XLSX.writeFile(wb, name)
export const workbookBlob = (wb) => new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
