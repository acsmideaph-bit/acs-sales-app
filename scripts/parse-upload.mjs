// Parse a TTA plan or final DSR file exactly as the Admin > Targets page does,
// and write the RPC payload as JSON. Used by the local RLS test
// (supabase/tests/03_targets_rls_smoke.sql) and to check a new file format.
//   node scripts/parse-upload.mjs plan "<TTA plan.csv|xlsx>" plan.json
//   node scripts/parse-upload.mjs dsr  "<final DSR.xlsx>"     dsr.json
// Output files contain company data: keep them out of git.
import fs from 'node:fs'
import XLSX from 'xlsx-js-style'
import { parsePlan, planPayload, parseDsr, sheetsToRows } from '../src/lib/targetImport.js'

const [, , kind, file, out] = process.argv
if (!['plan', 'dsr'].includes(kind) || !file || !out) {
  console.error('usage: node scripts/parse-upload.mjs plan|dsr <file> <out.json>')
  process.exit(1)
}
const sheets = sheetsToRows(XLSX, XLSX.read(fs.readFileSync(file), { type: 'buffer' }))
let parsed = null; let err = null
for (const s of sheets) { try { parsed = kind === 'plan' ? parsePlan(s.rows) : parseDsr(s.rows); break } catch (e) { err = e } }
if (!parsed) { console.error(err.message); process.exit(1) }
const { rows, warnings, total } = parsed
console.log(JSON.stringify({ rows: rows.length, total, dealers: parsed.dealers, handovers: parsed.handovers, kams: parsed.kams, columns: parsed.columns, warnings: warnings.map((w) => w.text) }, null, 1))
fs.writeFileSync(out, JSON.stringify(kind === 'plan' ? planPayload(parsed) : rows))
