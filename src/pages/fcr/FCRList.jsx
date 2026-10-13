import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt } from '../../lib/dates'
import { templateFor } from '../../lib/fcrTemplates'
import { PageHeader, Spinner, Empty, StatusChip, AckChip, Segmented } from '../../components/ui'

export function FCRList() {
  const { user, canFile, hasTeam } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [scope, setScope] = useState(canFile ? 'mine' : 'team')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')

  useEffect(() => {
    supabase.from('fcrs')
      .select('id, owner_id, account_id, template_id, template_version, visit_date, period, status, ack_status, attendee_name, companion_id, companion2_id, customer_info, updated_at')
      .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => setRows(data || []))
  }, [])

  const filtered = useMemo(() => (rows || []).filter((f) => {
    if (scope === 'mine' && f.owner_id !== user.id) return false
    if (scope === 'joint' && f.companion_id !== user.id && f.companion2_id !== user.id) return false
    if (scope === 'team' && f.owner_id === user.id) return false
    if (status === 'awaiting_ack' && !(f.ack_status !== 'acknowledged' && ['draft', 'rejected'].includes(f.status))) return false
    if (status && status !== 'awaiting_ack' && f.status !== status) return false
    if (month && !f.visit_date.startsWith(month)) return false
    const s = q.trim().toLowerCase()
    return !s || [f.customer_info?.company_name, byId[f.owner_id]?.full_name, f.attendee_name].some((v) => String(v || '').toLowerCase().includes(s))
  }), [rows, scope, status, q, month, user, byId])

  const months = [...new Set((rows || []).map((f) => f.visit_date.slice(0, 7)))]
  const scopes = [
    ...(canFile ? [{ value: 'mine', label: 'Mine' }] : []),
    ...(hasTeam ? [{ value: 'team', label: 'Team' }] : []),
    { value: 'joint', label: 'Joint visits' },
  ]

  return (
    <>
      <PageHeader title="Field Contact Reports" subtitle="One FCR per visit. The customer confirms the minutes; your direct superior approves."
        actions={canFile && <Link to="/fcr/new" className="btn-primary"><Plus size={15} /> New FCR</Link>} />
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <Segmented value={scope} onChange={setScope} options={scopes} />
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <input className="input pl-8" placeholder="Account, KAM, attendee" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="awaiting_ack">Needs customer acknowledgement</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Returned</option>
          </select>
          <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{fmt(m + '-01', 'MMMM yyyy')}</option>)}
          </select>
          <span className="ml-auto text-[12px] text-ink-3 tabular-nums">{filtered.length}</span>
        </div>
        {!rows ? <Spinner /> : filtered.length === 0 ? <Empty title="No FCRs here">{scope === 'mine' && canFile ? 'File one after each customer visit.' : ''}</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Visit</th>{scope !== 'mine' && <th>KAM</th>}<th>Account</th><th>Form</th><th>Attendee</th><th>Customer</th><th>Status</th></tr></thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => navigate(`/fcr/${f.id}`)}>
                    <td className="tabular-nums whitespace-nowrap">{fmt(f.visit_date)} <span className="text-ink-4">{f.period}</span></td>
                    {scope !== 'mine' && <td>{byId[f.owner_id]?.full_name}</td>}
                    <td className="font-medium">{f.customer_info?.company_name}</td>
                    <td className="text-ink-2">{templateFor(f.template_id, f.template_version).shortTitle}</td>
                    <td className="text-ink-2">{f.attendee_name}</td>
                    <td><AckChip status={f.ack_status} /></td>
                    <td><StatusChip status={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
