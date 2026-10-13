import { FILER_ROLES } from '../lib/roles'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, ArrowRight } from 'lucide-react'
import { format, addMonths } from 'date-fns'
import { supabase } from '../lib/supabase'
import { fetchBranch, useProfiles } from '../lib/data'
import { useAuth } from '../context/AuthContext'
import { usePendingCounts } from '../components/Layout'
import { fmt, ymd, weekStart, weekEnd, monthRange } from '../lib/dates'
import { PageHeader, Spinner, Stat, StatusChip, AckChip, Empty } from '../components/ui'

const bucket = (f) => f.status === 'approved' ? 'approved' : f.status === 'pending_approval' ? 'pending'
  : f.status === 'rejected' ? 'returned' : f.ack_status === 'pending' ? 'awaiting' : 'draft'

export function Dashboard() {
  const { user, profile, canFile: canFileAny, hasTeam, isApprover } = useAuth()
  // Personal field stats are for KAMs; RSMs and above can still file FCRs from the menu.
  const canFile = canFileAny && profile?.role === 'kam'
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const pending = usePendingCounts(isApprover)
  const [mine, setMine] = useState(null)
  const [team, setTeam] = useState(null)
  const ws = ymd(weekStart()); const we = ymd(weekEnd())
  const thisMonth = format(new Date(), 'yyyy-MM-01')
  const nextMonth = format(addMonths(new Date(), 1), 'yyyy-MM-01')
  const { start: ms, end: me } = monthRange(thisMonth)

  useEffect(() => {
    if (!canFile) return
    setMine(null)
    ;(async () => {
      const [{ data: fcrs }, { data: plans }] = await Promise.all([
        supabase.from('fcrs').select('id, visit_date, period, status, ack_status, customer_info, review_comment, ack_requested_at').eq('owner_id', user.id).gte('visit_date', ms < ws ? ms : ws).order('visit_date', { ascending: false }),
        supabase.from('itineraries').select('id, month, status, visits').eq('owner_id', user.id).in('month', [thisMonth, nextMonth]),
      ])
      // Open items regardless of date
      const { data: open } = await supabase.from('fcrs').select('id, visit_date, period, status, ack_status, customer_info, review_comment, ack_requested_at')
        .eq('owner_id', user.id).in('status', ['draft', 'rejected']).order('visit_date', { ascending: false })
      setMine({ fcrs: fcrs || [], plans: plans || [], open: open || [] })
    })().catch((e) => toast.error(e.message))
  }, [canFile, user, ms, ws, thisMonth, nextMonth])

  useEffect(() => {
    if (!hasTeam) return
    ;(async () => {
      const branch = (await fetchBranch()).filter((b) => FILER_ROLES.includes(b.role))
      const ids = branch.map((b) => b.id)
      if (!ids.length) return setTeam([])
      const [{ data: fcrs }, { data: plans }, { data: actual }] = await Promise.all([
        supabase.from('fcrs').select('owner_id, status, ack_status').in('owner_id', ids).gte('visit_date', ws).lte('visit_date', we),
        supabase.from('itineraries').select('owner_id, status, visits').in('owner_id', ids).eq('month', thisMonth),
        supabase.from('fcrs').select('owner_id').in('owner_id', ids).eq('status', 'approved').eq('ack_status', 'acknowledged').gte('visit_date', ms).lte('visit_date', me),
      ])
      setTeam(branch.map((b) => {
        const w = (fcrs || []).filter((f) => f.owner_id === b.id)
        const c = { draft: 0, awaiting: 0, pending: 0, approved: 0, returned: 0 }
        w.forEach((f) => { c[bucket(f)]++ })
        const plan = (plans || []).find((p) => p.owner_id === b.id)
        return { ...b, c, total: w.length, plan, planned: plan?.visits?.length || 0, actual: (actual || []).filter((a) => a.owner_id === b.id).length }
      }).sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.full_name.localeCompare(b.full_name)))
    })().catch((e) => { toast.error(e.message); setTeam([]) })
  }, [hasTeam, ws, we, ms, me, thisMonth])

  const myWeek = (mine?.fcrs || []).filter((f) => f.visit_date >= ws && f.visit_date <= we)
  const myMonthApproved = (mine?.fcrs || []).filter((f) => f.visit_date >= ms && f.visit_date <= me && f.status === 'approved' && f.ack_status === 'acknowledged').length
  const planThis = mine?.plans?.find((p) => p.month === thisMonth)
  const planNext = mine?.plans?.find((p) => p.month === nextMonth)
  const daysLeft = Number(format(new Date(me + 'T00:00:00'), 'd')) - new Date().getDate()

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${profile?.full_name?.split(' ')[0] || ''}`}
        subtitle={`Week of ${fmt(ws, 'MMM d')} – ${fmt(we, 'MMM d, yyyy')}`}
        actions={canFileAny && <Link to="/fcr/new" className="btn-primary"><Plus size={15} /> New FCR</Link>} />

      {isApprover && (pending.fcr + pending.plan) > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 px-4 py-3 rounded border border-warn/30 bg-warn-soft">
          <p className="text-[13px] text-warn flex-1"><strong>Waiting for your approval:</strong> {pending.fcr} FCR{pending.fcr === 1 ? '' : 's'} and {pending.plan} MCP Plan{pending.plan === 1 ? '' : 's'}.</p>
          {pending.fcr > 0 && <Link to="/fcr/approvals" className="btn-secondary">Review FCRs</Link>}
          {pending.plan > 0 && <Link to="/mcp/approvals" className="btn-secondary">Review plans</Link>}
        </div>
      )}

      {canFile && (!mine?.open ? <Spinner /> : (
        <div className="space-y-5 mb-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="FCRs this week" value={myWeek.length} sub={`${myWeek.filter((f) => f.status === 'approved').length} approved`} />
            <Stat label="Awaiting customer" value={mine.open.filter((f) => f.ack_status === 'pending').length} tone={mine.open.some((f) => f.ack_status === 'pending') ? 'warn' : undefined} sub="Acknowledgement requested" />
            <Stat label={`MCP Actual · ${fmt(thisMonth, 'MMM')}`} value={myMonthApproved} sub={planThis ? `of ${planThis.visits?.length || 0} planned` : 'No plan this month'} />
            <Stat label={`MCP Plan · ${fmt(nextMonth, 'MMM')}`} value={planNext ? planNext.status.replace('_', ' ') : 'Not started'}
              tone={!planNext && daysLeft <= 7 ? 'bad' : undefined} sub={!planNext ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left this month` : `${planNext.visits?.length || 0} visits`} />
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">My open FCRs</span><Link to="/fcr" className="text-[12px] text-accent flex items-center gap-1">All FCRs <ArrowRight size={12} /></Link></div>
            {mine.open.length === 0 ? <Empty title="Nothing open">Every FCR is with your superior or approved.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Visit</th><th>Account</th><th>Customer</th><th>Status</th><th>Next step</th></tr></thead>
                <tbody>
                  {mine.open.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => navigate(`/fcr/${f.id}`)}>
                      <td className="tabular-nums whitespace-nowrap">{fmt(f.visit_date)} <span className="text-ink-4">{f.period}</span></td>
                      <td className="font-medium">{f.customer_info?.company_name}</td>
                      <td><AckChip status={f.ack_status} /></td>
                      <td><StatusChip status={f.status} /></td>
                      <td className="text-ink-2 text-[12.5px]">{f.status === 'rejected' ? `Fix: ${f.review_comment || ''}` : f.ack_status === 'pending' ? 'Follow up with customer, or Copy link' : 'Send for acknowledgement'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ))}

      {hasTeam && (
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Team overview · this week</span><span className="text-[12px] text-ink-3">MCP columns are for {fmt(thisMonth, 'MMMM')}</span></div>
          {!team ? <Spinner /> : team.length === 0 ? <Empty title="No team members yet" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr>
                  <th>Name</th><th>Team</th><th className="num">Draft</th><th className="num">Awaiting customer</th><th className="num">Pending approval</th><th className="num">Approved</th><th className="num">Returned</th><th>MCP Plan</th><th className="num">MCP Actual</th>
                </tr></thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => navigate(`/mcp/actual?user=${t.id}`)}>
                      <td className="font-medium">{t.full_name}<span className="block text-2xs text-ink-4">{byId[t.supervisor_id]?.full_name}</span></td>
                      <td className="text-ink-2">{t.team}</td>
                      <td className="num text-ink-3">{t.c.draft || ''}</td>
                      <td className="num">{t.c.awaiting || ''}</td>
                      <td className={`num ${t.c.pending ? 'text-warn font-semibold' : ''}`}>{t.c.pending || ''}</td>
                      <td className={`num font-semibold ${t.c.approved === 0 ? 'text-bad' : ''}`}>{t.c.approved}</td>
                      <td className={`num ${t.c.returned ? 'text-bad' : ''}`}>{t.c.returned || ''}</td>
                      <td>{t.plan ? <StatusChip status={t.plan.status} /> : <span className="chip-rejected">None</span>}</td>
                      <td className="num tabular-nums">{t.actual}<span className="text-ink-4"> / {t.planned}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!canFile && !hasTeam && <div className="panel"><Empty title="Read-only access">Use Accounts, FCRs and MCP Archive from the menu.</Empty></div>}
    </>
  )
}
