import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { format, addMonths } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime } from '../../lib/dates'
import { PageHeader, Spinner, Empty, StatusChip, Segmented } from '../../components/ui'

export function PlanList() {
  const { user, canFile, hasTeam } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [plans, setPlans] = useState(null)
  const [scope, setScope] = useState(canFile ? 'mine' : 'team')
  const [month, setMonth] = useState('')

  useEffect(() => {
    supabase.from('itineraries').select('id, owner_id, month, status, visits, submitted_at, reviewed_at, review_comment, updated_at')
      .order('month', { ascending: false }).then(({ data }) => setPlans(data || []))
  }, [])

  const rows = useMemo(() => (plans || []).filter((p) =>
    (scope === 'mine' ? p.owner_id === user.id : p.owner_id !== user.id) && (!month || p.month === month)),
  [plans, scope, month, user])

  const months = [...new Set((plans || []).map((p) => p.month))]
  const next = format(addMonths(new Date(), 1), 'yyyy-MM-01')
  const thisM = format(new Date(), 'yyyy-MM-01')

  return (
    <>
      <PageHeader title="MCP Plan" subtitle="Monthly call plan: schedule visits by day and AM/PM, then submit to your direct superior."
        actions={canFile && <>
          <button className="btn-secondary" onClick={() => navigate('/mcp/plan/new', { state: { month: thisM } })}><Plus size={15} /> {fmt(thisM, 'MMMM')}</button>
          <button className="btn-primary" onClick={() => navigate('/mcp/plan/new', { state: { month: next } })}><Plus size={15} /> Plan {fmt(next, 'MMMM')}</button>
        </>} />
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          {hasTeam && canFile && <Segmented value={scope} onChange={setScope} options={[{ value: 'mine', label: 'My plans' }, { value: 'team', label: 'Team' }]} />}
          <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{fmt(m, 'MMMM yyyy')}</option>)}
          </select>
        </div>
        {!plans ? <Spinner /> : rows.length === 0 ? <Empty title="No plans here yet">{canFile && scope === 'mine' ? 'Start with next month\'s plan.' : ''}</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Month</th>{scope === 'team' && <><th>KAM</th><th>Team</th></>}<th className="num">Visits</th><th>Status</th><th>Submitted</th><th>Reviewer comment</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/mcp/plan/${p.id}`)}>
                    <td className="font-medium">{fmt(p.month, 'MMMM yyyy')}</td>
                    {scope === 'team' && <><td>{byId[p.owner_id]?.full_name}</td><td className="text-ink-2">{byId[p.owner_id]?.team}</td></>}
                    <td className="num">{(p.visits || []).length}</td>
                    <td><StatusChip status={p.status} /></td>
                    <td className="text-ink-2">{fmtDateTime(p.submitted_at)}</td>
                    <td className="text-ink-2 max-w-[320px] truncate">{p.review_comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!canFile && <p className="text-[12px] text-ink-3 mt-3">Read-only access. <Link className="text-accent" to="/mcp/actual">MCP Actual</Link> shows visits completed.</p>}
    </>
  )
}
