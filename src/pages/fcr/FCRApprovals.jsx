import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, X, Eye } from 'lucide-react'
import { supabase, rpc } from '../../lib/supabase'
import { useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime } from '../../lib/dates'
import { templateFor, normalizeFormData } from '../../lib/fcrTemplates'
import { buildMinutes } from '../../lib/fcrMinutes'
import { MinutesView } from '../../components/MinutesView'
import { PageHeader, Spinner, Empty, Modal, prompt } from '../../components/ui'
import { notifyPendingChanged } from '../../components/Layout'
import { ackRequestLine } from '../../lib/ack'

// Acknowledged FCRs from the signed-in superior's direct reports. Approval is
// enforced in the database (review_fcr checks supervisor_id).
export function FCRApprovals() {
  const { user } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState(new Set())

  const load = useCallback(async () => {
    const { data: reports } = await supabase.from('user_profiles').select('id').eq('supervisor_id', user.id)
    const ids = (reports || []).map((r) => r.id)
    if (!ids.length) return setRows([])
    const { data } = await supabase.from('fcrs').select('*').in('owner_id', ids).eq('status', 'pending_approval').order('visit_date')
    setRows(data || []); setSelected(new Set())
  }, [user])
  useEffect(() => { load() }, [load])

  const act = async (list, approve) => {
    let comment = null
    if (!approve) {
      comment = await prompt({ title: `Return ${list.length} FCR${list.length > 1 ? 's' : ''} to the KAM`, label: 'What needs to be corrected?', required: true, confirmLabel: 'Return', danger: true })
      if (!comment) return
    }
    let ok = 0
    for (const f of list) {
      try { await rpc('review_fcr', { p_id: f.id, p_approve: approve, p_comment: comment }); ok++ }
      catch (e) { toast.error(`${f.customer_info?.company_name}: ${e.message}`) }
    }
    if (ok) toast.success(`${ok} FCR${ok > 1 ? 's' : ''} ${approve ? 'approved' : 'returned'}`)
    setPreview(null); notifyPendingChanged(); load()
  }

  const minutesOf = (f) => {
    const t = templateFor(f.template_id, f.template_version)
    return buildMinutes({ fcr: { ...f, form_data: normalizeFormData(t, f.form_data) }, submitterName: byId[f.owner_id]?.full_name, submitterPosition: byId[f.owner_id]?.position })
  }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <>
      <PageHeader title="FCR approvals" subtitle="Reports from your direct reports that the customer has already confirmed."
        actions={selected.size > 0 && <button className="btn-ok" onClick={() => act(rows.filter((r) => selected.has(r.id)), true)}><Check size={14} /> Approve {selected.size} selected</button>} />
      <div className="panel">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="Nothing waiting for you">Acknowledged FCRs from your KAMs appear here, with a count in the sidebar.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th className="w-8"><input type="checkbox" aria-label="Select all" checked={selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                <th>Visit</th><th>KAM</th><th>Account</th><th>Confirmed by</th><th>Get-back items</th><th />
              </tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td><input type="checkbox" aria-label="Select" checked={selected.has(f.id)} onChange={() => toggle(f.id)} /></td>
                    <td className="tabular-nums whitespace-nowrap">{fmt(f.visit_date)} <span className="text-ink-4">{f.period}</span></td>
                    <td>{byId[f.owner_id]?.full_name}</td>
                    <td className="font-medium"><button className="hover:underline text-left" onClick={() => navigate(`/fcr/${f.id}`)}>{f.customer_info?.company_name}</button></td>
                    <td className="text-ink-2">{f.acknowledged_name}<span className="block text-2xs text-ink-4">{fmtDateTime(f.acknowledged_at)}</span>{f.ack_channel && <span className="block text-2xs text-ink-3">{ackRequestLine(f).replace(/ on .*$/, '')}</span>}</td>
                    <td className="text-ink-2 max-w-[260px] truncate">{f.form_data?.get_back_items}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-ghost" onClick={() => setPreview(f)}><Eye size={14} /> Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} width="max-w-2xl"
        title={preview ? `${preview.customer_info?.company_name} · ${fmt(preview.visit_date)}` : ''}
        footer={preview && <>
          <button className="btn-ghost mr-auto" onClick={() => navigate(`/fcr/${preview.id}`)}>Open full FCR</button>
          <button className="btn-danger" onClick={() => act([preview], false)}><X size={14} /> Return</button>
          <button className="btn-ok" onClick={() => act([preview], true)}><Check size={14} /> Approve</button>
        </>}>
        {preview && <>
          <MinutesView minutes={minutesOf(preview)} />
          <p className="mt-4 px-3 py-2 rounded bg-canvas text-[13px]"><span className="text-ink-3">Acknowledgement: </span>Confirmed by {preview.acknowledged_name} on {fmtDateTime(preview.acknowledged_at)}.{preview.ack_channel && <span className="block text-ink-2">{ackRequestLine(preview)}</span>}</p>
          {preview.acknowledged_comment && <p className="mt-4 px-3 py-2 rounded bg-canvas text-[13px]"><span className="text-ink-3">Customer comment: </span>{preview.acknowledged_comment}</p>}
        </>}
      </Modal>
    </>
  )
}
