// Creates Supabase Auth users for everyone on org_roster who doesn't have a
// login yet, with a temporary password, and writes the list to a local CSV
// for you to hand out (then delete the CSV).
//
// Run on YOUR computer only -- it needs the service role key, which must never
// be committed or put in the browser app:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs
// Add --dry-run to see who would be created.
//
// Roles, teams and direct superiors are applied automatically by the
// handle_new_user trigger from org_roster.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dry = process.argv.includes('--dry-run')
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const admin = createClient(url, key, { auth: { persistSession: false } })
const { data: roster, error } = await admin.from('org_roster').select('email, full_name, role, team').eq('active', true)
if (error) throw error
const { data: profiles } = await admin.from('user_profiles').select('email')
const have = new Set((profiles || []).map((p) => p.email.toLowerCase()))

const todo = roster.filter((r) => !have.has(r.email.toLowerCase()))
console.log(`${roster.length} on roster, ${todo.length} without a login`)
const out = [['name', 'email', 'role', 'team', 'temporary_password']]
for (const r of todo) {
  // Readable temporary password, e.g. "Acs-7f3k9q2m"
  const pw = `Acs-${randomBytes(6).toString('base64url').slice(0, 8)}`
  if (dry) { console.log('would create', r.email); continue }
  const { error: e } = await admin.auth.admin.createUser({ email: r.email, password: pw, email_confirm: true, user_metadata: { full_name: r.full_name } })
  if (e) { console.error('FAILED', r.email, e.message); continue }
  out.push([r.full_name, r.email, r.role, r.team || '', pw])
  console.log('created', r.email)
}
if (!dry && out.length > 1) {
  const file = `acs-temporary-passwords-${Date.now()}.csv`
  writeFileSync(file, out.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
  console.log(`\nWrote ${file}. Share each password privately, ask users to change it (Account > New password), then delete this file.`)
}
