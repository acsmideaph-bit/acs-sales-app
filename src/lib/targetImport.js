// Parsers for the two official uploads. Pure functions over an array of rows
// (SheetJS `sheet_to_json(ws, { header: 1, raw: true, defval: null })`), so the
// same code runs in the browser and in the local test script.
//
// 1. TTA plan ("ACS Master Monitoring (TTA PLAN SOURCE)"): one row per dealer x
//    KAM. Jan..Dec hold the target only in the months that KAM owns the dealer.
//    A blank month = not that KAM's month; a number (also 0 or "-") = owned.
// 2. Final DSR of a month: summed per BP code from the "Actual Sales" column,
//    RAC and LC lines only (MBT is not ACS sales).

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

// Excel and CSV give amounts as numbers or as text like "1,428,645", " -   ",
// "(1,200)". Returns null for blank, 0 for a dash.
export function amount(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '') return null
  if (/^[-–—]+$/.test(s)) return 0
  const neg = /^\(.*\)$/.test(s)
  const n = Number(s.replace(/[(),₱\s]/g, '').replace(/^PHP/i, ''))
  if (!Number.isFinite(n)) return NaN
  return neg ? -n : n
}

// BP codes are numbers in SAP; Excel may hand them over as numbers. Keep text.
export function bpCode(v) {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v))
  return String(v).replace(/\s+/g, '').replace(/\.0+$/, '')
}

export const kamLabel = (v) => norm(v)

function findHeader(rows, test, limit = 40) {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const cells = (rows[i] || []).map(norm)
    if (test(cells)) return { index: i, cells }
  }
  return null
}

const col = (cells, pred) => cells.findIndex(pred)

// ---------------------------------------------------------------------------
// TTA plan
// ---------------------------------------------------------------------------

export function parsePlan(rows) {
  const h = findHeader(rows, (c) => c.includes('BP CODE') && c.some((x) => x.includes('KAM')) && c.includes('JAN') && c.includes('DEC'))
  if (!h) throw new Error('This does not look like the TTA plan: no header row with KAM, BP CODE and JAN to DEC.')
  const c = h.cells
  const ix = {
    kam: col(c, (x) => x.includes('KAM')),
    area: col(c, (x) => x === 'AREA'),
    bp: col(c, (x) => x === 'BP CODE'),
    account: col(c, (x) => x === 'ACCOUNT'),
    registered: col(c, (x) => x.includes('REGISTERED')),
    mdm: col(c, (x) => x.includes('MDM')),
    tta: col(c, (x) => x.includes('TTA')),
    months: MONTHS.map((m) => col(c, (x) => x === m)),
  }
  if (ix.account < 0) throw new Error('No ACCOUNT column in the TTA plan.')
  if (ix.months.some((i) => i < 0)) throw new Error('The TTA plan must have one column per month, JAN to DEC.')

  // The row above the header carries the file's own monthly totals.
  const fileTotals = h.index > 0 ? ix.months.map((i) => amount(rows[h.index - 1]?.[i])) : null

  const out = []
  const warnings = []
  let rounding = 0
  for (let r = h.index + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const bp = bpCode(row[ix.bp])
    const account = String(row[ix.account] ?? '').replace(/\s+/g, ' ').trim()
    const kam = kamLabel(row[ix.kam])
    const months = ix.months.map((i) => amount(row[i]))
    if (!bp && !account && !kam && months.every((m) => m == null)) continue
    const line = r + 1
    if (months.some((m) => Number.isNaN(m))) warnings.push({ line, type: 'bad_amount', text: `Line ${line}: a month value is not a number` })
    const clean = months.map((m) => (Number.isNaN(m) ? null : m))
    const tta = ix.tta >= 0 ? amount(row[ix.tta]) : null
    const sum = clean.reduce((s, m) => s + (m || 0), 0)
    // Peso rounding from spreading an annual TTA over 12 months is normal;
    // only flag real differences row by row.
    if (tta != null && !Number.isNaN(tta) && Math.abs(sum - tta) >= 1) {
      if (Math.abs(sum - tta) <= 5) rounding += 1
      else warnings.push({ line, type: 'tta_mismatch', text: `${account} (${bp}), ${kam}: months add up to ${fmtPeso(sum)}, TTA column says ${fmtPeso(tta)}` })
    }
    out.push({
      line, bp_code: bp, account, kam_label: kam,
      registered_name: String(row[ix.registered] ?? '').replace(/\s+/g, ' ').trim() || null,
      mdm_name: String(row[ix.mdm] ?? '').replace(/\s+/g, ' ').trim() || null,
      area: norm(row[ix.area]) || null,
      months: clean,
    })
  }

  if (rounding) warnings.push({ type: 'rounding', text: `${rounding} row${rounding === 1 ? '' : 's'} differ from the TTA column by ₱5 or less (rounding). Monthly values are loaded as given.` })

  // Checks that need no database (the server repeats the blocking ones).
  const owners = new Map()
  const names = new Map()
  for (const p of out) {
    if (!p.bp_code) warnings.push({ line: p.line, type: 'no_bp_code', blocking: true, text: `Line ${p.line}: ${p.account || 'row'} has no BP code` })
    if (!p.kam_label) warnings.push({ line: p.line, type: 'no_kam', blocking: true, text: `Line ${p.line}: ${p.account} has no KAM` })
    if (!names.has(p.bp_code)) names.set(p.bp_code, new Set())
    names.get(p.bp_code).add(p.account.toUpperCase())
    p.months.forEach((m, i) => {
      if (m == null) return
      const k = `${p.bp_code}|${i}`
      if (owners.has(k)) warnings.push({ line: p.line, type: 'two_owners', blocking: true, text: `${p.account} (${p.bp_code}) has two KAMs in ${MONTHS[i]}: ${owners.get(k)} and ${p.kam_label}` })
      else owners.set(k, p.kam_label)
    })
  }
  for (const [bp, set] of names) if (set.size > 1) warnings.push({ type: 'two_names', blocking: true, text: `BP ${bp} has two account names: ${[...set].join(', ')}` })

  const monthTotals = MONTHS.map((_, i) => out.reduce((s, p) => s + (p.months[i] || 0), 0))
  if (fileTotals && fileTotals.some((t) => t != null)) {
    let small = 0
    fileTotals.forEach((t, i) => {
      if (t == null || Number.isNaN(t)) return
      const diff = monthTotals[i] - t
      if (Math.abs(diff) < 1) return
      if (Math.abs(diff) <= 50) { small += 1; return }
      warnings.push({ type: 'header_total', text: `${MONTHS[i]}: rows add up to ${fmtPeso(monthTotals[i])}, the file's total row says ${fmtPeso(t)} (difference ${fmtPeso(diff)})` })
    })
    if (small) warnings.push({ type: 'header_total', text: `In ${small} month${small === 1 ? '' : 's'} the rows differ from the file's total row by ₱50 or less (rounding).` })
  }

  const dealers = new Set(out.map((p) => p.bp_code)).size
  const handovers = [...names.keys()].filter((bp) => new Set(out.filter((p) => p.bp_code === bp).map((p) => p.kam_label)).size > 1).length
  const kams = [...new Set(out.map((p) => p.kam_label))].sort()
  return { rows: out, warnings, monthTotals, total: monthTotals.reduce((a, b) => a + b, 0), dealers, handovers, kams }
}

// Rows for the import_target_plan RPC.
export const planPayload = (parsed) => parsed.rows.map(({ bp_code, account, registered_name, mdm_name, area, kam_label, months }) =>
  ({ bp_code, account, registered_name, mdm_name, area, kam_label, months }))

// ---------------------------------------------------------------------------
// Final DSR
// ---------------------------------------------------------------------------

const isBpHeader = (x) => /^(BP|B\.P\.)\s*(CODE|NO\.?|NUMBER|#)$/.test(x) || x === 'BP CODE' || x === 'CUSTOMER BP CODE'
const isActualHeader = (x) => x === 'ACTUAL SALES' || /^ACTUAL SALES\b/.test(x)

// Only RAC and LC sales are credited to ACS; MBT (and anything else) sold to
// the same BP code is not ACS sales (Ronald, Oct 16, 2026). The DSR's
// product-group column is found by its values; every group is shown with its
// amount, and only the included ones are summed. No product-group column =
// refuse, rather than silently count MBT.
export const ACS_CATEGORIES = ['RAC', 'LC']
const CATEGORY_ALIASES = {
  RAC: ['RAC', 'ROOM AIR CONDITIONER', 'ROOM AIR CONDITIONERS', 'ROOM AIRCON', 'RESIDENTIAL AIR CONDITIONER', 'RESIDENTIAL AC'],
  LC: ['LC', 'LCAC', 'LIGHT COMMERCIAL', 'LIGHT COMMERCIAL AC', 'LIGHT COMMERCIAL AIR CONDITIONER'],
  MBT: ['MBT', 'MIDEA BUILDING TECHNOLOGIES', 'MIDEA BUILDING TECHNOLOGY'],
}
const KNOWN = new Map(Object.entries(CATEGORY_ALIASES).flatMap(([k, list]) => list.map((v) => [v, k])))
export const categoryOf = (v) => {
  const n = norm(v)
  return KNOWN.get(n) || n || '(blank)'
}

// The column whose values are mostly RAC / LC / MBT (by alias).
function detectCategoryColumn(rows, h, skip) {
  let best = -1; let bestHits = 0
  const width = Math.max(...rows.slice(h.index, h.index + 400).map((r) => (r || []).length))
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue
    let hits = 0
    for (let r = h.index + 1; r < Math.min(rows.length, h.index + 2000); r++) if (KNOWN.has(norm(rows[r]?.[c]))) hits++
    if (hits > bestHits) { best = c; bestHits = hits }
  }
  return bestHits > 0 ? best : -1
}

export function parseDsr(rows, { categoryCol = null, include = ACS_CATEGORIES, remap = {} } = {}) {
  const h = findHeader(rows, (c) => c.some(isBpHeader) && c.some(isActualHeader), 60)
  if (!h) throw new Error('Could not find the "BP Code" and "Actual Sales" columns in this file.')
  const bpIx = h.cells.findIndex(isBpHeader)
  const exact = h.cells.findIndex((x) => x === 'ACTUAL SALES')
  const amtIx = exact >= 0 ? exact : h.cells.findIndex(isActualHeader)
  const catIx = categoryCol ?? detectCategoryColumn(rows, h, [bpIx, amtIx])
  const headers = (rows[h.index] || []).map((v, i) => ({ index: i, label: String(v ?? '').trim() || `Column ${i + 1}` }))
  const base = { columns: { bp: rows[h.index][bpIx], amount: rows[h.index][amtIx], category: catIx >= 0 ? headers[catIx]?.label : null, categoryIndex: catIx, headerLine: h.index + 1 }, headers }
  if (catIx < 0) {
    return { ...base, needsCategory: true, rows: [], warnings: [], lines: 0, total: 0, categories: [] }
  }

  const inc = new Set(include)
  const by = new Map()
  const cats = new Map()
  const warnings = []
  let lines = 0
  for (let r = h.index + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const bp = bpCode(row[bpIx])
    const a = amount(row[amtIx])
    if (!bp) continue // subtotal / blank rows
    if (!/^[0-9A-Za-z-]{3,20}$/.test(bp)) { warnings.push({ line: r + 1, type: 'bad_bp_code', text: `Line ${r + 1}: "${bp}" is not a BP code, skipped` }); continue }
    if (a == null) continue
    if (Number.isNaN(a)) { warnings.push({ line: r + 1, type: 'bad_amount', text: `Line ${r + 1}: Actual Sales for ${bp} is not a number, skipped` }); continue }
    const found = categoryOf(row[catIx])
    const cat = remap[found] || found   // an admin may count an unfamiliar group name as RAC or LC
    const cs = cats.get(found) || { category: found, countedAs: cat, raw: new Set(), lines: 0, amount: 0, included: inc.has(cat) }
    cs.raw.add(String(row[catIx] ?? '').trim() || '(blank)'); cs.lines += 1; cs.amount += a
    cats.set(found, cs)
    if (!inc.has(cat)) continue
    const cur = by.get(bp) || { bp_code: bp, amount: 0, lines: 0 }
    cur.amount += a; cur.lines += 1; lines += 1
    by.set(bp, cur)
  }
  const out = [...by.values()].map((x) => ({ ...x, amount: Math.round(x.amount * 100) / 100 }))
  const categories = [...cats.values()]
    .map((c) => ({ ...c, raw: [...c.raw].slice(0, 5), amount: Math.round(c.amount * 100) / 100 }))
    .sort((a, b) => Number(b.included) - Number(a.included) || b.amount - a.amount)
  return {
    ...base, rows: out, warnings, lines, categories, include: [...inc],
    total: out.reduce((s, x) => s + x.amount, 0),
    excludedTotal: categories.filter((c) => !c.included).reduce((s, c) => s + c.amount, 0),
  }
}

export function fmtPeso(n) {
  if (n == null || Number.isNaN(n)) return ''
  return `₱${Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

// Workbook -> rows of the first sheet that a parser accepts.
export function sheetsToRows(XLSX, wb) {
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }) }))
}
