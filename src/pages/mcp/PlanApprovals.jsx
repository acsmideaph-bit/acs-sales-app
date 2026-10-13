import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { supabase, rpc } from '../../lib/supabase'
import { fetchAccounts, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime } from '../../lib/dates'
import { MonthCalendar } from '../../components/MonthCalendar'
import { PageHeader, Spinner, Empty, prompt, confirm } from '../../components/ui'
import { notifyPendingChanged } from '../../components/Layout'

// Only the DIRECT superior approves (enforced by review_itinerary in the DB).
export function PlanApprovals() {
  const { user } = useAuth()
  const { byId } = useProfiles()
  const [plans, setPlans] = useState(null)
  const [accById, setAccById] = useState({})
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const { data: reports } = await supabase.from('user_profiles').select('id').eq('supervisor_id', user.id)
    const ids = (reports || []).map((r) => r.id)
    if (!ids.length) return setPlans([])
    const { data } = await supabase.from('itineraries').select('*').in('owner_id', ids).eq('status', 'pending_approval').order('submitted_at')
    setPlans(data || [])
  }, [user])

  useEffect(() => { load(); fetchAccounts({ activeOnly: false }).then((a) => setAccById(Object.fromEntries(a.map((x) => [x.id, x])))) }, [load])

  const decide = async (p, approve) => {
    let comment = null
    if (approve) {
      if (!await confirm({ title: `Approve ${byId[p.owner_id]?.full_name}'s ${fmt(p.month, 'MMMM')} plan?`, body: `${(p.visits || []).length} visits.`, confirmLabel: 'Approve' })) return
    } else {
      comment = await prompt({ title: 'Return the plan for revision', label: 'What needs to change? (sent back to the KAM)', required: true, confirmLabel: 'Return plan', danger: true })
      if (!comment) return
    }
    try {
      await rpc('review_itinerary', { p_id: p.id, p_approve: approve, p_comment: comment })
      toast.success(approve ? 'Plan approved' : 'Plan returned')
      setPlans((list) => list.filter((x) => x.id !== p.id))
      notifyPendingChanged()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <PageHeader title="MCP Plan approvals" subtitle="Plans submitted by your direct reports." />
      <div className="panel">
        {!plans ? <Spinner /> : plans.length === 0 ? <Empty title="Nothing waiting for you">New submissions from your KAMs appear here, with a count in the sidebar.</Empty> : (
          <div className="divide-y divide-line">
            {plans.map((p) => {
              const visits = p.visits || []
              const accounts = new Set(visits.map((v) => v.account_id)).size
              const isOpen = open === p.id
              return (
                <div key={p.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button className="btn-ghost w-7 px-0" onClick={() => setOpen(isOpen ? null : p.id)} aria-label="Show plan">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{byId[p.owner_id]?.full_name} <span className="text-ink-3 font-normal">· {fmt(p.month, 'MMMM yyyy')}</span></p>
                      <p className="text-[12px] text-ink-3">{visits.length} visits · {accounts} accounts · submitted {fmtDateTime(p.submitted_at)}</p>
                    </div>
                    <button className="btn-danger" onClick={() => decide(p, false)}><X size={14} /> Return</button>
                    <button className="btn-ok" onClick={() => decide(p, true)}><Check size={14} /> Approve</button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-line">
                      <MonthCalendar month={p.month} readOnly items={visits.map((v) => ({ id: v.id, visit_date: v.visit_date, period: v.period, label: accById[v.account_id]?.company_name || 'Account', sub: v.purpose }))} />
                      {p.notes && <p className="px-4 py-3 text-[13px] text-ink-2 border-t border-line"><span className="text-ink-3">Notes: </span>{p.notes}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
