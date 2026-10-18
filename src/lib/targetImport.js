// Parsers for the two official uploads. Pure functions over an array of rows
// (SheetJS `sheet_to_json(ws, { header: 1, raw: true, defval: null })`), so the
// same code runs in the browser and in the local test script.
//
// 1. TTA plan ("ACS Master Monitoring (TTA PLAN SOURCE)"): one row per dealer x
//    KAM. Jan..Dec hold the target only in the months that KAM owns the dealer.
//    A blank month = not that KAM's month; a number (also 0 or "-") = owned.
// 2. Final DSR of a month: summed per BP code from the "Actual Sales" column,
//    RAC, LC and Window lines only (MBT is not ACS sales).

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
// The official amount: "Actual Sales" in the monthly DSR, "GROSS SALES" in the
// SAP gross-sales flat file (scenario ACT). Actual Sales wins when both exist.
const isActualHeader = (x) => x === 'ACTUAL SALES' || /^ACTUAL SALES\b/.test(x)
const isGrossHeader = (x) => x === 'GROSS SALES' || /^GROSS SALES\b/.test(x)
const isAmountHeader = (x) => isActualHeader(x) || isGrossHeader(x)

// Only RAC, LC and Window AC sales are credited to ACS (Window added Oct 16,
// 2026); MBT (and anything else) sold to the same BP code is not ACS sales
// (Ronald, Oct 16, 2026). The product-group column is found by its values;
// every group is shown with its amount, and only the included ones are summed.
// No product-group column = refuse, rather than silently count MBT.
// In the SAP flat file the group is "Product Line": HW (high wall = RAC),
// LC, WRAC (window), Parts, Portable.
export const ACS_CATEGORIES = ['RAC', 'LC', 'WINDOW']
export const CATEGORY_LABELS = { RAC: 'RAC (high wall)', LC: 'LC', WINDOW: 'Window AC', MBT: 'MBT', PARTS: 'Spare parts', PORTABLE: 'Portable AC' }
const CATEGORY_ALIASES = {
  RAC: ['RAC', 'HW', 'HIGH WALL', 'HIGHWALL', 'HI WALL', 'HIGH WALL INVERTER', 'HIGH WALL NON INVERTER', 'HIGH WALL NON-INVERTER',
    'ROOM AIR CONDITIONER', 'ROOM AIR CONDITIONERS', 'ROOM AIRCON', 'RESIDENTIAL AIR CONDITIONER', 'RESIDENTIAL AC'],
  LC: ['LC', 'LCAC', 'LIGHT COMMERCIAL', 'LIGHT COMMERCIAL AC', 'LIGHT COMMERCIAL AIR CONDITIONER', 'LC FLOOR MOUNTED', 'LC CASSETTE', 'LC UNDER CEILING'],
  WINDOW: ['WINDOW', 'WINDOW AC', 'WINDOW TYPE', 'WINDOW TYPE AC', 'WINDOW TYPE AIRCON', 'WINDOW TYPE AIR CONDITIONER', 'WINDOW AIRCON',
    'WINDOW AIR CONDITIONER', 'WINDOW-TYPE', 'WAC', 'WRAC', 'WRAC REMOTE', 'WRAC INV', 'WRAC MANUAL', 'WINDOW INVERTER'],
  PARTS: ['PARTS', 'SPARE PARTS', 'RAC SPARE PARTS', 'ACS - PARTS'],
  PORTABLE: ['PORTABLE', 'PORTABLE AC', 'PORTABLE AIR CONDITIONER'],
  MBT: ['MBT', 'MIDEA BUILDING TECHNOLOGIES', 'MIDEA BUILDING TECHNOLOGY'],
}
const KNOWN = new Map(Object.entries(CATEGORY_ALIASES).flatMap(([k, list]) => list.map((v) => [v, k])))
export const categoryOf = (v) => {
  const n = norm(v)
  return KNOWN.get(n) || n || '(blank)'
}

// The column that best separates the product groups: most distinct known
// groups, then most rows recognised; "Product Line" wins a tie. A column that
// only ever says one group (e.g. Product Category = RAC on every row) loses to
// one that tells HW, LC and WRAC apart.
function detectCategoryColumn(rows, h, skip) {
  let best = -1; let bestScore = [0, 0, 0]
  const width = Math.max(...rows.slice(h.index, h.index + 400).map((r) => (r || []).length))
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue
    let hits = 0
    const groups = new Set()
    for (let r = h.index + 1; r < Math.min(rows.length, h.index + 5000); r++) {
      const k = KNOWN.get(norm(rows[r]?.[c]))
      if (k) { hits++; groups.add(k) }
    }
    const score = [groups.size, hits, h.cells[c] === 'PRODUCT LINE' ? 1 : 0]
    const better = score[0] > bestScore[0] || (score[0] === bestScore[0] && (score[2] > bestScore[2] || (score[2] === bestScore[2] && score[1] > bestScore[1])))
    if (hits > 0 && better) { best = c; bestScore = score }
  }
  return best
}

const MONTH_WORDS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function monthNumber(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v >= 1 && v <= 12) return Math.round(v)
  const s = norm(v)
  const i = MONTH_WORDS.findIndex((m) => s.startsWith(m))
  if (i >= 0) return i + 1
  const n = Number(s.replace(/^P/, ''))
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`

// Options: categoryCol (index), include (groups counted for ACS), remap
// ({ group: 'RAC'|'LC'|'WINDOW' } for unfamiliar names), year (used when the
// file has a Month column but no Year column).
export function parseDsr(rows, { categoryCol = null, include = ACS_CATEGORIES, remap = {}, year = null } = {}) {
  const h = findHeader(rows, (c) => c.some(isBpHeader) && c.some(isAmountHeader), 60)
  if (!h) throw new Error('Could not find a "BP Code" column and an "Actual Sales" or "Gross Sales" column in this file.')
  const bpIx = h.cells.findIndex(isBpHeader)
  const actualIx = h.cells.findIndex(isActualHeader)
  const amtIx = actualIx >= 0 ? actualIx : h.cells.findIndex(isGrossHeader)
  const monthIx = h.cells.findIndex((x) => x === 'MONTH' || x === 'PERIOD' || x === 'FISCAL MONTH')
  const yearIx = h.cells.findIndex((x) => x === 'YEAR' || x === 'FISCAL YEAR')
  const scenarioIx = h.cells.findIndex((x) => x === 'SCENARIO')
  const catIx = categoryCol ?? detectCategoryColumn(rows, h, [bpIx, amtIx, monthIx, yearIx, scenarioIx])
  // Any other column that names MBT on a row (Product Category, Type, BU...)
  // makes that row MBT, whatever the product-group column says.
  const guardIx = h.cells.map((x, i) => (i !== catIx && /CATEGORY|TYPE|LINE|\bBU\b|BUSINESS|DIVISION|SEGMENT|GROUP/.test(x) ? i : -1)).filter((i) => i >= 0)
  const headers = (rows[h.index] || []).map((v, i) => ({ index: i, label: String(v ?? '').trim() || `Column ${i + 1}` }))
  const label = (i) => (i >= 0 ? headers[i]?.label : null)
  const base = {
    columns: { bp: label(bpIx), amount: label(amtIx), category: label(catIx), categoryIndex: catIx, month: label(monthIx), year: label(yearIx), scenario: label(scenarioIx), headerLine: h.index + 1 },
    headers, multiMonth: monthIx >= 0,
  }
  if (catIx < 0) return { ...base, needsCategory: true, months: [], rows: [], warnings: [], lines: 0, total: 0, categories: [] }

  const inc = new Set(include)
  const months = new Map()   // 'yyyy-mm-01' (or 'single') -> { by: Map, cats: Map, lines }
  const cats = new Map()
  const warnings = []
  let skippedScenario = 0
  let lines = 0
  const bucket = (k) => { if (!months.has(k)) months.set(k, { month: k === 'single' ? null : k, by: new Map(), cats: new Map(), lines: 0 }); return months.get(k) }
  const addCat = (map, found, countedAs, raw, a) => {
    const cs = map.get(found) || { category: found, countedAs, raw: new Set(), lines: 0, amount: 0, included: inc.has(countedAs) }
    cs.raw.add(raw); cs.lines += 1; cs.amount += a
    map.set(found, cs)
  }
  for (let r = h.index + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const bp = bpCode(row[bpIx])
    if (!bp) continue // subtotal / blank rows
    if (scenarioIx >= 0 && !/ACT/.test(norm(row[scenarioIx]))) { skippedScenario++; continue }
    const a = amount(row[amtIx])
    if (!/^[0-9A-Za-z-]{3,20}$/.test(bp)) { warnings.push({ line: r + 1, type: 'bad_bp_code', text: `Line ${r + 1}: "${bp}" is not a BP code, skipped` }); continue }
    if (a == null) continue
    if (Number.isNaN(a)) { warnings.push({ line: r + 1, type: 'bad_amount', text: `Line ${r + 1}: amount for ${bp} is not a number, skipped` }); continue }
    let key = 'single'
    if (monthIx >= 0) {
      const m = monthNumber(row[monthIx])
      const y = yearIx >= 0 ? Number(row[yearIx]) : year
      if (!m || !y) { warnings.push({ line: r + 1, type: 'bad_month', text: `Line ${r + 1}: month "${row[monthIx] ?? ''}" / year "${yearIx >= 0 ? row[yearIx] ?? '' : year ?? ''}" not understood, skipped` }); continue }
      key = ym(y, m)
    }
    const mbt = guardIx.some((i) => KNOWN.get(norm(row[i])) === 'MBT')
    const found = mbt ? 'MBT' : categoryOf(row[catIx])
    const cat = mbt ? 'MBT' : (remap[found] || found)   // an admin may count an unfamiliar group name as RAC, LC or Window
    const raw = String(row[catIx] ?? '').trim() || '(blank)'
    const b = bucket(key)
    addCat(cats, found, cat, raw, a)
    addCat(b.cats, found, cat, raw, a)
    if (!inc.has(cat)) continue
    const cur = b.by.get(bp) || { bp_code: bp, amount: 0, lines: 0 }
    cur.amount += a; cur.lines += 1; b.lines += 1; lines += 1
    b.by.set(bp, cur)
  }
  if (skippedScenario) warnings.push({ type: 'scenario', text: `${skippedScenario} line${skippedScenario === 1 ? '' : 's'} not in an actual (ACT) scenario were left out` })

  const finishCats = (map) => [...map.values()]
    .map((c) => ({ ...c, raw: [...c.raw].slice(0, 5), amount: Math.round(c.amount * 100) / 100 }))
    .sort((x, y) => Number(y.included) - Number(x.included) || y.amount - x.amount)
  const monthList = [...months.values()]
    .map((b) => {
      const out = [...b.by.values()].map((x) => ({ ...x, amount: Math.round(x.amount * 100) / 100 }))
      const categories = finishCats(b.cats)
      return {
        month: b.month, rows: out, lines: b.lines, categories,
        total: out.reduce((s, x) => s + x.amount, 0),
        excludedTotal: categories.filter((c) => !c.included).reduce((s, c) => s + c.amount, 0),
      }
    })
    .sort((x, y) => String(x.month).localeCompare(String(y.month)))
  const categories = finishCats(cats)
  const single = monthList.length === 1 && !base.multiMonth ? monthList[0] : null
  return {
    ...base, months: monthList, warnings, lines, categories, include: [...inc],
    // single-month files keep the flat shape the page used before
    rows: single ? single.rows : monthList.flatMap((m) => m.rows),
    total: monthList.reduce((s, m) => s + m.total, 0),
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
