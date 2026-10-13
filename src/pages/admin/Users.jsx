import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Plus, Pencil } from 'lucide-react'
import { supabase, rpc } from '../../lib/supabase'
import { fetchProfiles } from '../../lib/data'
import { ROLE_LABELS } from '../../lib/roles'
import { PageHeader, Spinner, Modal, Field, Segmented } from '../../components/ui'

// The org chart is data: org_roster (by email) drives each user's role, team
// and direct superior. Approval routing and digests follow supervisor_id.
// Auth users themselves are created with scripts/create-users.mjs (needs the
// service role key, which must never be in the browser).
const ROLES = Object.keys(ROLE_LABELS)
const blankRow = { email: '', full_name: '', position: '', role: 'kam', team: '', area: '', supervisor_email: '', notify_email: '', active: true }

export function Users() {
  const [tab, setTab] = useState('people')
  const [profiles, setProfiles] = useState(null)
  const [roster, setRoster] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setProfiles(await fetchProfiles())
    const { data } = await supabase.from('org_roster').select('*').order('team').order('full_name')
    setRoster(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const sync = async () => {
    setBusy(true)
    try { await rpc('sync_profiles_from_roster'); toast.success('Profiles updated from the roster'); await load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const toggleReadOnly = async (p) => {
    const { error } = await supabase.from('user_profiles').update({ read_only: !p.read_only }).eq('id', p.id)
    if (error) toast.error(error.message); else { toast.success(`${p.full_name} is now ${p.read_only ? 'able to edit' : 'read-only'}`); load() }
  }

  const saveRoster = async () => {
    const r = { ...edit.row, email: edit.row.email.trim().toLowerCase(), supervisor_email: edit.row.supervisor_email?.trim().toLowerCase() || null, notify_email: edit.row.notify_email?.trim() || null, updated_at: new Date().toISOString() }
    if (!r.email || !r.full_name) { toast.error('Email and name are required'); return }
    const { error } = await supabase.from('org_roster').upsert(r, { onConflict: 'email' })
    if (error) { toast.error(error.message); return }
    setEdit(null)
    await sync()
  }

  const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const registered = new Set((profiles || []).map((p) => p.email.toLowerCase()))

  return (
    <>
      <PageHeader title="Users and org chart" subtitle="Edit the roster, then sync. Each KAM's direct superior approves their FCRs and MCP Plans."
        actions={<>
          <button className="btn-secondary" onClick={sync} disabled={busy}><RefreshCw size={14} /> Sync from roster</button>
          <button className="btn-primary" onClick={() => setEdit({ row: { ...blankRow }, isNew: true })}><Plus size={14} /> Add person</button>
        </>} />
      <div className="mb-3"><Segmented value={tab} onChange={setTab} options={[{ value: 'people', label: 'Signed-up users' }, { value: 'roster', label: 'Org roster' }]} /></div>
      <div className="panel overflow-x-auto">
        {!profiles || !roster ? <Spinner /> : tab === 'people' ? (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Direct superior</th><th>Digests to</th><th>Access</th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.full_name}<span className="block text-2xs text-ink-4">{p.position}</span></td>
                  <td className="text-ink-2">{p.email}</td>
                  <td>{ROLE_LABELS[p.role]}</td>
                  <td className="text-ink-2">{p.team}</td>
                  <td>{byId[p.supervisor_id]?.full_name || <span className="text-ink-4">—</span>}</td>
                  <td className="text-ink-2">{p.notify_email || <span className="text-ink-4">login email</span>}</td>
                  <td>{!p.active ? <span className="chip-rejected">Inactive</span> : (
                    <button title="Per-user read-only override" onClick={() => toggleReadOnly(p)} className={p.read_only ? 'chip-draft' : 'chip-approved'}>{p.read_only ? 'Read-only' : 'Active'}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Reports to</th><th>Account</th><th /></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.email}>
                  <td className="font-medium">{r.full_name}<span className="block text-2xs text-ink-4">{r.position}</span></td>
                  <td className="text-ink-2">{r.email}</td>
                  <td>{ROLE_LABELS[r.role]}</td>
                  <td className="text-ink-2">{r.team}</td>
                  <td className="text-ink-2">{roster.find((x) => x.email === r.supervisor_email)?.full_name || r.supervisor_email || '—'}</td>
                  <td>{registered.has(r.email.toLowerCase()) ? <span className="chip-approved">Created</span> : <span className="chip-pending">Not created</span>}{!r.active && <span className="chip-rejected ml-1">Inactive</span>}</td>
                  <td className="text-right"><button className="btn-ghost" onClick={() => setEdit({ row: { ...r } })}><Pencil size={13} /> Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[12px] text-ink-3 mt-3 max-w-3xl">To give someone a login: add them to the roster here, then create their account with <code className="text-[12px]">scripts/create-users.mjs</code> or Supabase dashboard → Authentication → Add user. Their role, team and superior are applied automatically. People who sign in without being on the roster see nothing.</p>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.isNew ? 'Add person to roster' : 'Edit roster entry'}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={saveRoster}>Save and sync</button></>}>
        {edit && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Company email" className="sm:col-span-2"><input className="input" disabled={!edit.isNew} value={edit.row.email} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, email: e.target.value } })} /></Field>
            <Field label="Full name"><input className="input" value={edit.row.full_name} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, full_name: e.target.value } })} /></Field>
            <Field label="Position"><input className="input" value={edit.row.position || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, position: e.target.value } })} /></Field>
            <Field label="Role"><select className="input" value={edit.row.role} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, role: e.target.value } })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
            <Field label="Team"><input className="input" value={edit.row.team || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, team: e.target.value } })} placeholder="NCR, Vis-Min, NL-CL-SL" /></Field>
            <Field label="Reports to (direct superior)" className="sm:col-span-2">
              <select className="input" value={edit.row.supervisor_email || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, supervisor_email: e.target.value } })}>
                <option value="">Nobody (top of chart)</option>
                {roster.filter((r) => r.email !== edit.row.email).map((r) => <option key={r.email} value={r.email}>{r.full_name} · {ROLE_LABELS[r.role]}</option>)}
              </select>
            </Field>
            <Field label="Send digests to (optional)" className="sm:col-span-2"><input className="input" value={edit.row.notify_email || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, notify_email: e.target.value } })} /></Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={edit.row.active} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, active: e.target.checked } })} /> Active</label>
          </div>
        )}
      </Modal>
    </>
  )
}
