import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Send, Eye, RefreshCw } from 'lucide-react'
import { supabase, invokeFunction } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtDateTime } from '../../lib/dates'
import { PageHeader, Spinner, Empty, Modal, confirm } from '../../components/ui'

const KIND = { fcr_ack: 'FCR acknowledgement', weekly_digest: 'Weekly digest', monthly_digest: 'Monthly digest', test: 'Test send' }

// Our own record of every email attempt (MBT lesson 1: Gmail "sent" is not
// "delivered"). Admins can preview digests and send test copies to themselves
// before launch (email reliability plan, step 5).
export function EmailLog() {
  const { isAdmin, profile } = useAuth()
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    supabase.from('email_log').select('*').order('created_at', { ascending: false }).limit(500).then(({ data }) => setRows(data || []))
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn, mode) => {
    if (mode === 'send_to_me' && !await confirm({ title: 'Send test digests to yourself?', body: `Every recipient's digest will be sent to ${profile?.notify_email || profile?.email}, marked [TEST].`, confirmLabel: 'Send' })) return
    setBusy(fn + mode)
    try {
      const res = await invokeFunction(fn, { mode })
      if (mode === 'preview') setPreview(res)
      else { toast.success(`${(res.results || []).filter((r) => r.result === 'sent').length} of ${res.recipients} sent`); load() }
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title="Email log" subtitle="Every email the app tried to send. If something shows as sent but never arrived, the recipient's mail gateway likely quarantined it."
        actions={<>
          <button className="btn-ghost" onClick={load}><RefreshCw size={14} /> Refresh</button>
          {isAdmin && <>
            <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => run('weekly-digest', 'preview')}><Eye size={14} /> Preview weekly</button>
            <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => run('monthly-digest', 'preview')}><Eye size={14} /> Preview monthly</button>
            <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => run('weekly-digest', 'send_to_me')}><Send size={14} /> Test weekly to me</button>
          </>}
        </>} />
      <div className="panel">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="No emails yet" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>When</th><th>Type</th><th>To</th><th>Subject</th><th>Result</th><th>Error</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums text-ink-2">{fmtDateTime(r.created_at)}</td>
                    <td>{KIND[r.kind] || r.kind}</td>
                    <td>{r.recipient}</td>
                    <td className="text-ink-2 max-w-[320px] truncate">{r.subject}</td>
                    <td><span className={r.result === 'sent' ? 'chip-approved' : r.result === 'failed' ? 'chip-rejected' : 'chip-draft'}>{r.result}</span></td>
                    <td className="text-bad text-[12px] max-w-[260px] truncate" title={r.error || ''}>{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={`Digest preview · ${preview?.range?.start || ''} to ${preview?.range?.end || ''}`} width="max-w-4xl"
        footer={<button className="btn-secondary" onClick={() => setPreview(null)}>Close</button>}>
        {preview && (preview.previews?.length ? preview.previews.map((p, i) => (
          <div key={i} className="mb-6">
            <p className="text-[12px] text-ink-3 mb-1">To <strong className="text-ink">{p.to}</strong> · {p.subject}</p>
            <iframe title={`preview-${i}`} sandbox="" srcDoc={p.html} className="w-full h-[420px] border border-line rounded" />
          </div>
        )) : <Empty title="No recipients">Nobody in the org chart has direct reports yet.</Empty>)}
      </Modal>
    </>
  )
}
