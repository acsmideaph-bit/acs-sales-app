import { jsPDF } from 'jspdf'
import { ackRequestLine } from './ack'
import { supabase } from './supabase'
import { photoFacts, photoFlags, mapsUrl, PHOTO_BUCKET } from './photo'
import autoTable from 'jspdf-autotable'
import logoUrl from './cmip-logo.jpg'
import { fmt, fmtDateTime } from './dates'
import {
  templateFor, HEADER_FIELDS, filledRows, columnTotal, peso, matrixCell, matrixColumnLabels, normalizeFormData,
} from './fcrTemplates'
import { buildMinutes } from './fcrMinutes'
import { monthWeeks, byDayPeriod, monthLabel, WEEKDAYS } from './mcp'
import { ACK_LABELS, STATUS_LABELS } from './roles'

// PDFs are generated in the browser (no server cost). The FCR layout follows
// the ACS paper form: black section bars, bordered tables, signature block --
// with the e-acknowledgement in place of the wet signature.

let logoDataUrl = null
async function logo() {
  if (logoDataUrl) return logoDataUrl
  const blob = await (await fetch(logoUrl)).blob()
  logoDataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
  return logoDataUrl
}

const M = 36 // page margin (pt)
const BAR = [29, 29, 31]

export const newDoc = () => new jsPDF({ unit: 'pt', format: 'letter' })

function bar(doc, y, title) {
  const w = doc.internal.pageSize.getWidth() - M * 2
  if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = M }
  doc.setFillColor(...BAR); doc.rect(M, y, w, 15, 'F')
  doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8.5); doc.setTextColor(255)
  doc.text(title, M + 5, y + 10.5)
  doc.setTextColor(0)
  return y + 15
}

const tableStyles = {
  theme: 'grid',
  styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.4, textColor: [20, 20, 20], overflow: 'linebreak', valign: 'top' },
  headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
  margin: { left: M, right: M },
}

function textBox(doc, y, text, minH = 40) {
  autoTable(doc, { ...tableStyles, startY: y, body: [[text || ' ']], styles: { ...tableStyles.styles, minCellHeight: minH, fontSize: 8 } })
  return doc.lastAutoTable.finalY + 10
}

async function header(doc, title) {
  const pw = doc.internal.pageSize.getWidth()
  try { doc.addImage(await logo(), 'JPEG', M, M - 6, 92, 52) } catch { /* logo optional */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(title, pw / 2 + 30, M + 8, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text('CONCEPCION MIDEA INC. PHILIPPINES', pw / 2 + 30, M + 21, { align: 'center' })
  doc.setFontSize(7.5)
  doc.text('Km 20 East Service Road, South Superhighway, Alabang, Muntinlupa 1700', pw / 2 + 30, M + 32, { align: 'center' })
  return M + 56
}

function gridSection(doc, y, s, v) {
  y = bar(doc, y, s.title)
  if (s.fields?.length) {
    const cells = s.fields.map((f) => `${f.label}: ${f.type === 'number' ? peso(v?.f?.[f.key]) : (v?.f?.[f.key] || '')}`)
    autoTable(doc, { ...tableStyles, startY: y, body: [cells], styles: { ...tableStyles.styles, fontStyle: 'bold' } })
    y = doc.lastAutoTable.finalY
  }
  const cols = [...(s.rowKey ? [{ key: s.rowKey, label: s.rowLabel }] : []), ...s.columns]
  const rows = s.fixedRows ? (v?.rows || []) : filledRows(s, v)
  const body = (rows.length ? rows : [{}]).map((r) => cols.map((c) =>
    c.type === 'number' ? peso(r[c.key]) : c.type === 'date' ? fmt(r[c.key], 'MM/dd/yy') : (r[c.key] || '')))
  const foot = s.totals?.length
    ? [cols.map((c, i) => (s.totals.includes(c.key) ? peso(columnTotal(v, c.key)) : i === 0 ? 'TOTAL' : ''))]
    : undefined
  autoTable(doc, {
    ...tableStyles, startY: y,
    head: [cols.map((c) => c.label)], body, foot,
    footStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, {
      halign: c.type === 'number' ? 'right' : 'left',
      fontStyle: s.rowKey && i === 0 ? 'bold' : 'normal',
    }])),
  })
  return doc.lastAutoTable.finalY + 10
}

// Official account target vs actual (snapshot in the FCR), months as columns.
function performanceSection(doc, y, s, v) {
  y = bar(doc, y, `${s.title}${v?.bp_code ? `  (BP ${v.bp_code})` : ''}`)
  if (!v?.bp_code) { autoTable(doc, { ...tableStyles, startY: y, body: [['No TTA target found for this account and year.']] }); return doc.lastAutoTable.finalY + 10 }
  const n0 = (n) => (n == null ? '' : Math.round(Number(n) / 1000).toLocaleString('en-PH'))
  const loaded = (m) => v.as_of && m <= v.as_of
  const head = [["PHP '000", ...v.months.map((r) => fmt(r.month, 'MMM')), v.as_of ? `YTD ${fmt(v.as_of, 'MMM')}` : 'FY']]
  const ach = (a, t) => (t ? `${((a / t) * 100).toFixed(0)}%` : '')
  const body = [
    ['Target', ...v.months.map((r) => n0(r.target)), n0(v.as_of ? v.ytd_target : v.fy_target)],
    ['Actual sales', ...v.months.map((r) => (loaded(r.month) ? n0(r.actual ?? 0) : '-')), v.as_of ? n0(v.ytd_actual) : ''],
    ['Achievement', ...v.months.map((r) => (loaded(r.month) ? ach(r.actual ?? 0, r.target) : '')), v.as_of ? ach(v.ytd_actual, v.ytd_target) : ''],
  ]
  const vi = v.months.findIndex((r) => r.month === v.visit_month) + 1
  autoTable(doc, {
    ...tableStyles, startY: y, head, body,
    styles: { ...tableStyles.styles, fontSize: 6.5, cellPadding: 2 },
    columnStyles: Object.fromEntries([...Array(14).keys()].map((i) => [i, { halign: i === 0 ? 'left' : 'right', fontStyle: i === 0 || i === 13 || i === vi ? 'bold' : 'normal' }])),
  })
  y = doc.lastAutoTable.finalY
  doc.setFontSize(6.5); doc.setTextColor(90)
  doc.text(`Target: TTA plan. Actual: RAC, LC and Window AC from the final DSR, MBT excluded${v.as_of ? ` loaded through ${fmt(v.as_of, 'MMMM yyyy')}` : ' (none loaded yet)'}. YTD covers the months loaded. FY ${v.year} TTA target: PHP ${Number(v.fy_target || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}.`, M, y + 8)
  doc.setTextColor(0)
  return y + 16
}

function matrixSection(doc, y, s, v) {
  y = bar(doc, y, `${s.title}  (${s.periodLabel}: ${v?.period || ''})`)
  const labels = matrixColumnLabels(s, v?.period)
  const body = []
  for (const g of s.groups) {
    body.push([{ content: g, colSpan: s.columns.length + 1, styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }])
    for (const m of s.metrics) {
      body.push([{ content: m.label, styles: { fontStyle: 'italic', halign: 'right' } },
        ...s.columns.map((c) => { const n = matrixCell(s, v, g, m.key, c.key); return n == null ? '' : peso(n) })])
    }
  }
  autoTable(doc, {
    ...tableStyles, startY: y, head: [['', ...labels]], body,
    columnStyles: Object.fromEntries(s.columns.map((_, i) => [i + 1, { halign: 'right' }])),
  })
  return doc.lastAutoTable.finalY + 10
}

export async function renderFcr(doc, { fcr, submitterName, submitterPosition, reviewerName, firstPage = true }) {
  const t = templateFor(fcr.template_id, fcr.template_version)
  const fd = normalizeFormData(t, fcr.form_data)
  const ci = fcr.customer_info || {}
  if (!firstPage) doc.addPage()
  const startPage = doc.getNumberOfPages()
  let y = await header(doc, t.title)

  y = bar(doc, y, 'Customer Information')
  const hf = HEADER_FIELDS(t)
  const pairs = []
  for (let i = 0; i < hf.length; i += 2) pairs.push([`${hf[i][1]}:`, ci[hf[i][0]] || '', `${hf[i + 1][1]}:`, ci[hf[i + 1][0]] || ''])
  autoTable(doc, {
    ...tableStyles, startY: y, theme: 'plain', body: pairs,
    styles: { ...tableStyles.styles, lineWidth: 0 },
    columnStyles: { 0: { halign: 'right', fontStyle: 'bold', cellWidth: 92 }, 2: { halign: 'right', fontStyle: 'bold', cellWidth: 92 } },
  })
  y = doc.lastAutoTable.finalY
  autoTable(doc, {
    ...tableStyles, startY: y + 2,
    body: [[`ASE / TSE: ${submitterName || ci.ase_tse || ''}`, `Visit Freq / Days: ${ci.visit_freq_days || ''}`, `Visit Date: ${fmt(fcr.visit_date, 'MM/dd/yyyy')} (${fcr.period})`]],
    styles: { ...tableStyles.styles, fontStyle: 'bold', fontSize: 8 },
  })
  y = doc.lastAutoTable.finalY + 10

  for (const s of t.sections) {
    if (s.kind === 'text') { y = bar(doc, y, s.title); y = textBox(doc, y, fd[s.key], s.key === 'coverage_notes' ? 70 : 45) }
    else if (s.kind === 'matrix') y = matrixSection(doc, y, s, fd[s.key])
    else if (s.kind === 'performance') y = performanceSection(doc, y, s, fd[s.key])
    else y = gridSection(doc, y, s, fd[s.key])
  }

  // Minutes + acknowledgement (replaces "Customer name / signature over printed name")
  const minutes = buildMinutes({ fcr: { ...fcr, form_data: fd }, submitterName, submitterPosition })
  y = bar(doc, y, 'Minutes of the Meeting (as acknowledged by the customer)')
  const mBody = [
    ...minutes.meta.map(([k, v]) => [{ content: k, styles: { fontStyle: 'bold' } }, v]),
    ...minutes.blocks.map((b) => [{ content: b.title, styles: { fontStyle: 'bold' } }, b.lines.map((l) => `• ${l}`).join('\n')]),
  ]
  autoTable(doc, { ...tableStyles, startY: y, body: mBody, columnStyles: { 0: { cellWidth: 120 } } })
  y = doc.lastAutoTable.finalY + 10

  const ackText = fcr.ack_status === 'acknowledged'
    ? `Confirmed electronically by ${fcr.acknowledged_name} on ${fmtDateTime(fcr.acknowledged_at)}${fcr.ack_channel ? `\nRequest: ${ackRequestLine(fcr)}` : ''}${fcr.acknowledged_comment ? `\nCustomer comment: ${fcr.acknowledged_comment}` : ''}`
    : `Customer acknowledgement: ${ACK_LABELS[fcr.ack_status] || fcr.ack_status}`
  autoTable(doc, {
    ...tableStyles, startY: y,
    body: [
      [{ content: 'CUSTOMER NAME', styles: { fontStyle: 'bold' } }, `${fcr.attendee_name || ''}${fcr.attendee_designation ? `, ${fcr.attendee_designation}` : ''}`, { content: 'Date of Visit', styles: { fontStyle: 'bold' } }, fmt(fcr.visit_date, 'MM/dd/yyyy')],
      [{ content: 'Acknowledgement', styles: { fontStyle: 'bold' } }, { content: ackText, colSpan: 3 }],
      [{ content: 'Review', styles: { fontStyle: 'bold' } }, { content: `${STATUS_LABELS[fcr.status] || fcr.status}${reviewerName ? ` by ${reviewerName}` : ''}${fcr.reviewed_at ? ` on ${fmtDateTime(fcr.reviewed_at)}` : ''}${fcr.review_comment ? `\nComment: ${fcr.review_comment}` : ''}`, colSpan: 3 }],
    ],
    columnStyles: { 0: { cellWidth: 92 }, 2: { cellWidth: 70 } },
  })

  y = doc.lastAutoTable.finalY + 10
  y = await photoSection(doc, y, fcr)

  // Footer on every page of THIS FCR (combined exports hold many FCRs).
  const last = doc.getNumberOfPages()
  doc.setFontSize(6.5); doc.setTextColor(120)
  for (let p = startPage; p <= last; p++) {
    doc.setPage(p)
    doc.text(`${t.title} v${t.version} · FCR ${String(fcr.id || '').slice(0, 8)} · ${fcr.customer_info?.company_name || ''} · page ${p - startPage + 1} of ${last - startPage + 1} · generated ${fmtDateTime(new Date().toISOString())}`, M, doc.internal.pageSize.getHeight() - 16)
  }
  doc.setTextColor(0)
  return last
}

// Visit photo + its recorded time/location. The image is included while the
// file exists (60-day retention); the details are always printed.
async function photoSection(doc, y, fcr) {
  if (!fcr?.id) return y
  const { data: photo } = await supabase.from('fcr_photos').select('*').eq('fcr_id', fcr.id).maybeSingle()
  if (!photo) return y
  let img = null; let iw = 0; let ih = 0
  if (!photo.purged_at) {
    try {
      const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photo.storage_path, 300)
      const blob = await (await fetch(data.signedUrl)).blob()
      img = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
      const ratio = (photo.height || 3) / (photo.width || 4)
      iw = 190; ih = Math.min(240, iw * ratio); if (ih === 240) iw = ih / ratio
    } catch { img = null }
  }
  const need = Math.max(ih, 80) + 30
  if (y + need > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = M }
  y = bar(doc, y, 'Visit Photo (evidence of customer engagement)')
  const top = y + 8
  if (img) doc.addImage(img, 'JPEG', M, top, iw, ih)
  const tx = img ? M + iw + 14 : M
  const tw = doc.internal.pageSize.getWidth() - M - tx
  const flags = photoFlags(photo, fcr.visit_date)
  let ty = top + 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  for (const line of [...photoFacts(photo), ...(photo.lat != null ? [`Map: ${mapsUrl(photo.lat, photo.lng)}`] : [])]) {
    const parts = doc.splitTextToSize(line, tw); doc.text(parts, tx, ty); ty += parts.length * 10 + 2
  }
  if (flags.length) {
    doc.setTextColor(170, 100, 0); doc.setFont('helvetica', 'bold')
    for (const f of flags) { const parts = doc.splitTextToSize(`To check: ${f}`, tw); doc.text(parts, tx, ty); ty += parts.length * 10 + 2 }
    doc.setTextColor(0); doc.setFont('helvetica', 'normal')
  }
  return Math.max(top + ih, ty) + 10
}

export const fcrFileName = (fcr, ownerName) =>
  `FCR ${fcr.visit_date} ${(fcr.customer_info?.company_name || 'Account').replace(/[\\/:*?"<>|]/g, '')} - ${ownerName || ''}.pdf`.replace(/\s+/g, ' ')

export async function downloadFcrPdf(args) {
  const doc = newDoc()
  await renderFcr(doc, args)
  doc.save(fcrFileName(args.fcr, args.submitterName))
}

export async function fcrPdfBlob(args) {
  const doc = newDoc()
  await renderFcr(doc, args)
  return doc.output('blob')
}

// ---------------------------------------------------------------------------
// MCP (Plan or Actual) calendar PDF -- landscape, Mon-Fri grid, AM/PM rows.
// ---------------------------------------------------------------------------
export function renderMcp(doc, { title, month, ownerName, ownerTeam, items, notes = {}, summary, firstPage = true }) {
  if (!firstPage) doc.addPage('letter', 'landscape')
  const pw = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(`${title} - ${monthLabel(month)}`, M, M + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`${ownerName}${ownerTeam ? ` · ${ownerTeam}` : ''}`, M, M + 18)
  if (summary) doc.text(summary, pw - M, M + 18, { align: 'right' })
  const hasSat = items.some((v) => new Date(`${v.visit_date}T00:00:00`).getDay() === 6)
  const weeks = monthWeeks(month, { includeSaturday: hasSat })
  const grouped = byDayPeriod(items, (v) => v.label)
  const head = [['Week', '', ...WEEKDAYS.slice(0, hasSat ? 6 : 5)]]
  const body = []
  for (const w of weeks) {
    body.push([{ content: `W${w.n}`, rowSpan: 3, styles: { fontStyle: 'bold', valign: 'middle' } }, { content: '', styles: { fillColor: [245, 245, 245] } },
      ...w.days.map((d) => ({ content: d ? fmt(d, 'MMM d') : '', styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }))])
    for (const p of ['AM', 'PM']) {
      body.push([{ content: p, styles: { fontStyle: 'bold' } }, ...w.days.map((d) => {
        if (!d) return ''
        const list = grouped[d]?.[p] || []
        const note = p === 'PM' && notes[d] ? `\nNote: ${notes[d]}` : ''
        return list.join('\n') + note
      })])
    }
  }
  autoTable(doc, {
    ...tableStyles, startY: M + 28, head, body,
    styles: { ...tableStyles.styles, fontSize: 7, minCellHeight: 14 },
    headStyles: { ...tableStyles.headStyles, fillColor: BAR, textColor: 255 },
    columnStyles: { 0: { cellWidth: 34, halign: 'center' }, 1: { cellWidth: 26, halign: 'center' } },
  })
}

export function mcpPdfBlob(args) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  renderMcp(doc, args)
  return doc.output('blob')
}

export function downloadMcpPdf(args, fileName) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  renderMcp(doc, args)
  doc.save(fileName)
}

// Snapshot (Archive) -> renderMcp args
export const snapshotToMcpArgs = (snap) => ({
  title: 'MCP Actual',
  month: snap.month,
  ownerName: snap.owner?.full_name || '',
  ownerTeam: snap.owner?.team || '',
  items: (snap.visits || []).map((v) => ({ ...v, label: v.company })),
  notes: snap.notes || {},
  summary: `${(snap.visits || []).length} approved visit(s)${snap.planned_count != null ? ` of ${snap.planned_count} planned` : ''} · generated ${fmtDateTime(snap.generated_at)}`,
})
