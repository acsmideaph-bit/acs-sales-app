import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, FileDown, ArrowLeft } from 'lucide-react'
import { format, addMonths } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchAccounts, fetchFilers, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, toDate, todayYmd } from '../../lib/dates'
import { fetchActualVisits, fetchPlans, fetchDailyNotes, saveDailyNote, buildSnapshot, monthLabel } from '../../lib/mcp'
import { downloadSnapshotPdf } from '../../lib/lazy'
import { MonthCalendar } from '../../components/MonthCalendar'
import { PageHeader, Spinner, Empty, Modal, Segmented } from '../../components/ui'

// MCP Actual = approved + acknowledged FCRs, computed live, shown against the
// MCP Plan. Superiors get a roster of their branch from day one (MBT showed
// approvers an empty screen here).
export function McpActual() {
  const { user, profile, canFile, hasTeam, canWrite } = useAuth()
  const { byId } = useProfiles()
  const [params, setParams] = useSearchParams()
  const month = (params.get('month') || format(new Date(), 'yyyy-MM')) + '-01'
  const selectedUser = params.get('user') || (canFile ? user.id : null)
  const [view, setView] = useState(canFile ? 'me' : 'team')
  const setMonth = (m) => setParams((p) => { const n = new URLSearchParams(p); n.set('month', m.slice(0, 7)); return n })
  const openUser = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('user', id); return n })
  const closeUser = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('user'); return n })

  const showTeam = hasTeam && view === 'team' && !params.get('user')
  return (
    <>
      <PageHeader title="MCP Actual" subtitle="Visits that the customer acknowledged and the direct superior approved, against the MCP Plan."
        actions={<>
          {hasTeam && canFile && !params.get('user') && <Segmented value={view} onChange={setView} options={[{ value: 'me', label: 'Mine' }, { value: 'team', label: 'Team' }]} />}
          <div className="flex items-center gap-1">
            <button className="btn-secondary w-8 px-0" onClick={() => setMonth(format(addMonths(toDate(month), -1), 'yyyy-MM-01'))} aria-label="Previous month"><ChevronLeft size={15} /></button>
            <span className="w-32 text-center text-[13px] font-medium">{monthLabel(month)}</span>
            <button className="btn-secondary w-8 px-0" onClick={() => setMonth(format(addMonths(toDate(month), 1), 'yyyy-MM-01'))} aria-label="Next month"><ChevronRight size={15} /></button>
          </div>
        </>} />
      {showTeam ? <TeamRoster month={month} byId={byId} onOpen={openUser} />
        : selectedUser ? <PersonActual key={selectedUser + month} month={month} userId={selectedUser} owner={byId[selectedUser] || (selectedUser === user.id ? profile : null)}
            isSelf={selectedUser === user.id} canWrite={canWrite} onBack={params.get('user') ? closeUser : null} />
          : <Empty title="Choose a team member" />}
    </>
  )
}

function TeamRoster({ month, byId, onOpen }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    (async () => {
      const branch = await fetchFilers()
      const ids = branch.map((b) => b.id)
      const [visits, plans] = await Promise.all([fetchActualVisits({ ownerIds: ids, month }), fetchPlans({ ownerIds: ids, month })])
      setRows(branch.map((b) => {
        const plan = plans.find((p) => p.owner_id === b.id)
        const actual = visits.filter((v) => v.owner_id === b.id)
        return { ...b, planStatus: plan?.status, planned: plan?.visits?.length || 0, actual: actual.length, accounts: new Set(actual.map((a) => a.account_id)).size }
      }).sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.full_name.localeCompare(b.full_name)))
    })().catch((e) => { toast.error(e.message); setRows([]) })
  }, [month])
  if (!rows) return <Spinner />
  if (!rows.length) return <div className="panel"><Empty title="No team members found">Your direct reports appear here once they are linked to you in the org chart.</Empty></div>
  return (
    <div className="panel overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>KAM</th><th>Team</th><th>Superior</th><th>MCP Plan</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">Accounts</th><th>Plan vs actual</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.planned ? Math.round((r.actual / r.planned) * 100) : null
            return (
              <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                <td className="font-medium">{r.full_name}</td>
                <td className="text-ink-2">{r.team}</td>
                <td className="text-ink-2">{byId[r.supervisor_id]?.full_name}</td>
                <td>{r.planStatus ? <span className={`chip-${r.planStatus === 'approved' ? 'approved' : r.planStatus === 'rejected' ? 'rejected' : r.planStatus === 'pending_approval' ? 'pending' : 'draft'}`}>{r.planStatus.replace('_', ' ')}</span> : <span className="chip-rejected">No plan</span>}</td>
                <td className="num">{r.planned}</td>
                <td className={`num font-semibold ${r.actual === 0 ? 'text-bad' : ''}`}>{r.actual}</td>
                <td className="num">{r.accounts}</td>
                <td className="w-40">
                  {pct != null && <div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded bg-black/[0.07] overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} /></div><span className="text-[12px] tabular-nums w-9 text-right">{pct}%</span></div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PersonActual({ month, userId, owner, isSelf, canWrite, onBack }) {
  const navigate = useNavigate()
  const [visits, setVisits] = useState(null)
  const [plan, setPlan] = useState(null)
  const [notes, setNotes] = useState({})
  const [accById, setAccById] = useState({})
  const [noteEdit, setNoteEdit] = useState(null)
  const [showPlan, setShowPlan] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [v, p, n, a] = await Promise.all([
      fetchActualVisits({ ownerIds: [userId], month }), fetchPlans({ ownerIds: [userId], month }),
      fetchDailyNotes({ userId, month }), fetchAccounts({ activeOnly: false }),
    ])
    setVisits(v); setPlan(p[0] || null); setNotes(n); setAccById(Object.fromEntries(a.map((x) => [x.id, x])))
  }, [userId, month])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  const items = useMemo(() => {
    if (!visits) return []
    const done = visits.map((v) => ({ id: v.id, visit_date: v.visit_date, period: v.period, label: v.company, tone: 'done' }))
    if (!showPlan || !plan) return done
    const today = todayYmd()
    const missed = (plan.visits || []).filter((pv) => !visits.some((v) => v.account_id === pv.account_id && v.visit_date === pv.visit_date))
      .map((pv) => ({ id: `p-${pv.id}`, visit_date: pv.visit_date, period: pv.period, label: accById[pv.account_id]?.company_name || 'Account', tone: pv.visit_date < today ? 'missed' : 'plan', sub: 'Planned' }))
    return [...done, ...missed]
  }, [visits, plan, showPlan, accById])

  if (!visits) return <Spinner />
  const planned = plan?.visits?.length || 0

  const generate = async () => {
    setBusy(true)
    try {
      const snap = buildSnapshot({ month, owner: owner || { id: userId, full_name: '' }, visits, planned, notes })
      const { error } = await supabase.from('mcp_archive').insert({ owner_id: userId, month, snapshot: snap })
      if (error) throw error
      downloadSnapshotPdf(snap, `MCP Actual ${month.slice(0, 7)} - ${owner?.full_name || ''}.pdf`)
      toast.success('Saved to MCP Archive and downloaded')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const saveNote = async () => {
    try { await saveDailyNote({ date: noteEdit.date, note: noteEdit.text }); setNotes((n) => ({ ...n, [noteEdit.date]: noteEdit.text.trim() || undefined })); setNoteEdit(null) }
    catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {onBack && <button className="btn-ghost -ml-2 text-ink-3" onClick={onBack}><ArrowLeft size={14} /> Team</button>}
        <p className="text-[15px] font-semibold">{owner?.full_name}</p>
        {owner?.team && <span className="text-[13px] text-ink-3">{owner.team}</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2"><input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> Show planned visits not yet done</label>
          {canWrite && <button className="btn-primary" onClick={generate} disabled={busy}><FileDown size={14} /> Generate and export PDF</button>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Planned</p><p className="kpi">{planned}</p></div>
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Actual</p><p className="kpi">{visits.length}</p></div>
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Accounts</p><p className="kpi">{new Set(visits.map((v) => v.account_id)).size}</p></div>
      </div>
      <div className="panel">
        <div className="flex flex-wrap gap-4 px-4 py-2 border-b border-line text-[12px] text-ink-3">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-ok-soft border border-ok/30" /> Approved visit</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-accent-soft border border-accent/20" /> Planned, upcoming</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-bad-soft border border-bad/30" /> Planned, no approved FCR</span>
        </div>
        <MonthCalendar month={month} items={items} notes={notes} readOnly
          onItemClick={(it) => !String(it.id).startsWith('p-') && navigate(`/fcr/${it.id}`)}
          onNoteClick={isSelf && canWrite ? (d) => setNoteEdit({ date: d, text: notes[d] || '' }) : (d) => notes[d] && toast.message(notes[d])} />
      </div>
      <Modal open={Boolean(noteEdit)} onClose={() => setNoteEdit(null)} title={noteEdit ? `Note for ${fmt(noteEdit.date, 'EEE, MMM d')}` : ''}
        footer={<><button className="btn-secondary" onClick={() => setNoteEdit(null)}>Cancel</button><button className="btn-primary" onClick={saveNote}>Save note</button></>}>
        {noteEdit && <textarea className="input min-h-[96px]" autoFocus value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} placeholder="Leave, office work, training, site visit without FCR…" />}
        <p className="text-2xs text-ink-4 mt-2">For things an FCR would not capture. Empty to remove.</p>
      </Modal>
    </>
  )
}
