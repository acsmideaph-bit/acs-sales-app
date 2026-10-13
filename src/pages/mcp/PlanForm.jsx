import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Save, Send, Trash2, Undo2, FileDown, Copy } from 'lucide-react'
import { format, addMonths, parseISO } from 'date-fns'
import { supabase, rpc } from '../../lib/supabase'
import { fetchAccounts, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime, monthRange } from '../../lib/dates'
import { workingDays } from '../../lib/mcp'
import { downloadMcpPdf } from '../../lib/lazy'
import { MonthCalendar } from '../../components/MonthCalendar'
import { PageHeader, Spinner, StatusChip, Modal, Field, Segmented, confirm } from '../../components/ui'
import { notifyPendingChanged } from '../../components/Layout'

const newVisit = (date = '') => ({ id: crypto.randomUUID(), account_id: '', visit_date: date, period: 'AM', purpose: '', notes: '' })
const PURPOSES = ['Account review', 'Collection', 'Product training', 'Program execution', 'Project follow-up', 'Sub-dealer development', 'Merchandising / mock-up', 'Prospecting']

export function PlanForm() {
  const { id } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const { user, canFile } = useAuth()
  const { byId } = useProfiles()
  const [plan, setPlan] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [view, setView] = useState('calendar')
  const [editing, setEditing] = useState(null) // { index|null, v }
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { fetchAccounts().then(setAccounts) }, [])
  useEffect(() => {
    if (id) {
      supabase.from('itineraries').select('*').eq('id', id).single().then(({ data, error }) => {
        if (error) { toast.error('Plan not found'); navigate('/mcp/plan'); return }
        setPlan(data)
      })
    } else {
      const month = state?.month || format(addMonths(new Date(), 1), 'yyyy-MM-01')
      // One plan per KAM per month: open the existing one instead of a duplicate.
      supabase.from('itineraries').select('id').eq('owner_id', user.id).eq('month', month).maybeSingle().then(({ data }) => {
        if (data) navigate(`/mcp/plan/${data.id}`, { replace: true })
        else setPlan({ month, visits: [], notes: '', status: 'draft', owner_id: user.id })
      })
    }
  }, [id, state, user, navigate])

  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])
  if (!plan) return <Spinner />

  const isOwner = plan.owner_id === user.id
  const editable = isOwner && canFile && ['draft', 'rejected'].includes(plan.status)
  const visits = plan.visits || []
  const { start, end } = monthRange(plan.month)
  const items = visits.map((v) => ({ id: v.id, visit_date: v.visit_date, period: v.period, label: accById[v.account_id]?.company_name || 'Account', sub: v.purpose }))
  const myAccounts = accounts.filter((a) => a.kam_id === plan.owner_id)
  const otherAccounts = accounts.filter((a) => a.kam_id !== plan.owner_id)
  const uniqueAccounts = new Set(visits.map((v) => v.account_id)).size

  const setVisits = (fn) => { setPlan((p) => ({ ...p, visits: fn(p.visits || []) })); setDirty(true) }
  const saveVisit = () => {
    const v = editing.v
    if (!v.account_id || !v.visit_date) { toast.error('Pick an account and a date'); return }
    if (v.visit_date < start || v.visit_date > end) { toast.error(`Date must be within ${fmt(plan.month, 'MMMM yyyy')}`); return }
    setVisits((list) => editing.index == null ? [...list, v] : list.map((x, i) => (i === editing.index ? v : x)))
    setEditing(null)
  }

  const persist = async () => {
    const payload = { month: plan.month, visits: [...visits].sort((a, b) => (a.visit_date + a.period).localeCompare(b.visit_date + b.period)), notes: plan.notes || '' }
    if (plan.id) {
      const { error } = await supabase.from('itineraries').update(payload).eq('id', plan.id)
      if (error) throw error
      return plan.id
    }
    const { data, error } = await supabase.from('itineraries').insert(payload).select().single()
    if (error) throw error
    return data.id
  }

  const save = async () => {
    setBusy(true)
    try { const pid = await persist(); setDirty(false); toast.success('Saved as draft'); if (!plan.id) navigate(`/mcp/plan/${pid}`, { replace: true }) }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!visits.length) { toast.error('Add at least one visit'); return }
    setBusy(true)
    try {
      const pid = await persist()
      await rpc('submit_itinerary', { p_id: pid })
      toast.success('Submitted to your direct superior')
      notifyPendingChanged()
      const { data } = await supabase.from('itineraries').select('*').eq('id', pid).single()
      setPlan(data); setDirty(false)
      if (!plan.id) navigate(`/mcp/plan/${pid}`, { replace: true })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const reopen = async () => {
    if (!await confirm({ title: 'Revise this plan?', body: 'It goes back to draft and must be submitted and approved again.', confirmLabel: 'Revise' })) return
    try {
      await rpc('reopen_itinerary', { p_id: plan.id })
      const { data } = await supabase.from('itineraries').select('*').eq('id', plan.id).single()
      setPlan(data)
    } catch (e) { toast.error(e.message) }
  }

  const remove = async () => {
    if (!await confirm({ title: 'Delete this draft plan?', danger: true, confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('itineraries').delete().eq('id', plan.id)
    if (error) toast.error(error.message); else navigate('/mcp/plan')
  }

  // Copy last month's visits (same weekday pattern) as a starting point.
  const copyPrevious = async () => {
    const prev = format(addMonths(parseISO(plan.month), -1), 'yyyy-MM-01')
    const { data } = await supabase.from('itineraries').select('visits').eq('owner_id', user.id).eq('month', prev).maybeSingle()
    if (!data?.visits?.length) { toast.message('No plan found for last month'); return }
    const shifted = data.visits.map((v) => {
      const d = parseISO(v.visit_date)
      const target = new Date(parseISO(plan.month).getFullYear(), parseISO(plan.month).getMonth(), Math.min(d.getDate(), 28))
      // move forward to the same weekday
      while (target.getDay() !== d.getDay()) target.setDate(target.getDate() + 1)
      const ds = format(target, 'yyyy-MM-dd')
      return ds <= end ? { ...v, id: crypto.randomUUID(), visit_date: ds } : null
    }).filter(Boolean)
    setVisits((list) => [...list, ...shifted])
    toast.success(`Copied ${shifted.length} visits. Review the dates before submitting.`)
  }

  const pdf = () => downloadMcpPdf({
    title: 'MCP Plan', month: plan.month, ownerName: byId[plan.owner_id]?.full_name || '', ownerTeam: byId[plan.owner_id]?.team,
    items: visits.map((v) => ({ ...v, label: `${accById[v.account_id]?.company_name || 'Account'}${v.purpose ? ` - ${v.purpose}` : ''}` })),
    summary: `${visits.length} visits · ${uniqueAccounts} accounts · status: ${plan.status.replace('_', ' ')}`,
  }, `MCP Plan ${fmt(plan.month, 'yyyy-MM')} - ${byId[plan.owner_id]?.full_name || ''}.pdf`)

  return (
    <>
      <PageHeader
        title={`MCP Plan · ${fmt(plan.month, 'MMMM yyyy')}`}
        subtitle={isOwner ? undefined : `${byId[plan.owner_id]?.full_name || ''} · ${byId[plan.owner_id]?.team || ''}`}
        back={<Link to="/mcp/plan" className="btn-ghost -ml-2 mb-1 text-ink-3"><ArrowLeft size={14} /> MCP Plan</Link>}
        actions={<>
          <StatusChip status={plan.status} />
          {plan.id && <button className="btn-secondary" onClick={pdf}><FileDown size={14} /> PDF</button>}
          {isOwner && canFile && plan.status === 'draft' && plan.id && <button className="btn-ghost text-bad" onClick={remove}><Trash2 size={14} /></button>}
          {isOwner && canFile && ['approved', 'pending_approval'].includes(plan.status) && <button className="btn-secondary" onClick={reopen}><Undo2 size={14} /> Revise</button>}
          {editable && <button className="btn-secondary" onClick={save} disabled={busy}><Save size={14} /> Save draft</button>}
          {editable && <button className="btn-primary" onClick={submit} disabled={busy}><Send size={14} /> Submit for approval</button>}
        </>} />

      {plan.status === 'rejected' && plan.review_comment && (
        <div className="mb-4 px-4 py-3 rounded border border-bad/30 bg-bad-soft text-[13px] text-bad">
          <strong>Returned by {byId[plan.reviewed_by]?.full_name || 'your superior'}:</strong> {plan.review_comment}
        </div>
      )}
      {plan.status === 'approved' && (
        <div className="mb-4 px-4 py-3 rounded border border-ok/30 bg-ok-soft text-[13px] text-ok">
          Approved by {byId[plan.reviewed_by]?.full_name} on {fmtDateTime(plan.reviewed_at)}{plan.review_comment ? `: ${plan.review_comment}` : ''}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Visits</p><p className="kpi">{visits.length}</p></div>
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Accounts</p><p className="kpi">{uniqueAccounts}</p></div>
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Working days</p><p className="kpi">{workingDays(plan.month)}</p></div>
        <div className="panel px-4 py-3"><p className="text-2xs uppercase tracking-[0.05em] text-ink-3 font-semibold">Visits / day</p><p className="kpi">{(visits.length / workingDays(plan.month)).toFixed(1)}</p></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <Segmented value={view} onChange={setView} options={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]} />
          <div className="flex gap-2">
            {editable && visits.length === 0 && <button className="btn-ghost" onClick={copyPrevious}><Copy size={14} /> Copy last month</button>}
            {editable && <button className="btn-secondary" onClick={() => setEditing({ index: null, v: newVisit(start) })}>Add visit</button>}
          </div>
        </div>
        {view === 'calendar' ? (
          <MonthCalendar month={plan.month} items={items} readOnly={!editable}
            onAddDay={(d) => setEditing({ index: null, v: newVisit(d) })}
            onItemClick={(it) => { const i = visits.findIndex((v) => v.id === it.id); setEditing({ index: i, v: { ...visits[i] }, readOnly: !editable }) }} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Date</th><th>AM/PM</th><th>Account</th><th>Purpose</th><th>Notes</th></tr></thead>
              <tbody>
                {[...visits].sort((a, b) => (a.visit_date + a.period).localeCompare(b.visit_date + b.period)).map((v) => (
                  <tr key={v.id} className="clickable" onClick={() => { const i = visits.findIndex((x) => x.id === v.id); setEditing({ index: i, v: { ...v }, readOnly: !editable }) }}>
                    <td className="tabular-nums whitespace-nowrap">{fmt(v.visit_date, 'EEE, MMM d')}</td><td>{v.period}</td>
                    <td className="font-medium">{accById[v.account_id]?.company_name}</td><td className="text-ink-2">{v.purpose}</td><td className="text-ink-2">{v.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="p-4 border-t border-line">
          <Field label="Plan notes">
            <textarea className="input min-h-[60px]" disabled={!editable} value={plan.notes || ''} onChange={(e) => { setPlan({ ...plan, notes: e.target.value }); setDirty(true) }} placeholder="Leave days, trainings, out-of-town trips…" />
          </Field>
          {dirty && editable && <p className="text-[12px] text-warn mt-2">Unsaved changes.</p>}
        </div>
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.readOnly ? 'Planned visit' : editing?.index == null ? 'Add visit' : 'Edit visit'}
        footer={editing?.readOnly ? <button className="btn-secondary" onClick={() => setEditing(null)}>Close</button> : <>
          {editing?.index != null && <button className="btn-ghost text-bad mr-auto" onClick={() => { setVisits((l) => l.filter((_, i) => i !== editing.index)); setEditing(null) }}><Trash2 size={14} /> Remove</button>}
          <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn-primary" onClick={saveVisit}>{editing?.index == null ? 'Add' : 'Update'}</button>
        </>}>
        {editing && (
          <fieldset disabled={editing.readOnly} className="space-y-4">
            <Field label="Account">
              <select className="input" value={editing.v.account_id} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, account_id: e.target.value } })}>
                <option value="">Select account</option>
                <optgroup label="Assigned to this KAM">{myAccounts.map((a) => <option key={a.id} value={a.id}>{a.company_name}</option>)}</optgroup>
                <optgroup label="Other accounts">{otherAccounts.map((a) => <option key={a.id} value={a.id}>{a.company_name}</option>)}</optgroup>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" className="input" min={start} max={end} value={editing.v.visit_date} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, visit_date: e.target.value } })} /></Field>
              <Field label="Period"><Segmented value={editing.v.period} onChange={(p) => !editing.readOnly && setEditing({ ...editing, v: { ...editing.v, period: p } })} options={[{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }]} /></Field>
            </div>
            <Field label="Purpose">
              <input className="input" list="dl-purpose" value={editing.v.purpose} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, purpose: e.target.value } })} />
              <datalist id="dl-purpose">{PURPOSES.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Notes"><textarea className="input min-h-[60px]" value={editing.v.notes} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, notes: e.target.value } })} /></Field>
          </fieldset>
        )}
      </Modal>
    </>
  )
}
