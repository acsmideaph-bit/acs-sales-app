import { FILER_ROLES } from '../../lib/roles'
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { addWeeks } from 'date-fns'
import { fetchBranch, fetchReportFcrs, useProfiles, downloadBlob } from '../../lib/data'
import { fmt, ymd, weekStart, weekEnd, toDate, monthsBetween } from '../../lib/dates'
import { reportZip } from '../../lib/lazy'
import { PageHeader, Spinner, Empty } from '../../components/ui'

// Same data as the Friday digest, always available in the app so approvers
// never depend on email (MBT lesson 1). Week = Monday to Sunday.
export function WeeklyReport() {
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const start = ymd(weekStart(toDate(params.get('start') || ymd(new Date()))))
  const end = ymd(weekEnd(toDate(start)))
  const [data, setData] = useState(null)
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    if (!Object.keys(byId).length) return
    setData(null)
    ;(async () => {
      const branch = (await fetchBranch()).filter((b) => FILER_ROLES.includes(b.role))
      const fcrs = await fetchReportFcrs({ from: start, to: end, ownerIds: branch.map((b) => b.id), approvedOnly: true, byId })
      setData({ branch, fcrs })
    })().catch((e) => { toast.error(e.message); setData({ branch: [], fcrs: [] }) })
  }, [start, end, byId])

  const go = (n) => setParams({ start: ymd(addWeeks(toDate(start), n)) })
  const download = async () => {
    try {
      setProgress([0, 1])
      const ids = data.branch.map((b) => b.id)
      const blob = await reportZip({ fcrs: data.fcrs, ownerIds: ids, byId, months: monthsBetween(start, end), onProgress: (a, b) => setProgress([a, b]) })
      downloadBlob(blob, `ACS weekly report ${start} to ${end}.zip`)
    } catch (e) { toast.error(e.message) } finally { setProgress(null) }
  }

  const groups = {}
  ;(data?.branch || []).forEach((b) => { const k = byId[b.supervisor_id]?.full_name || '—'; (groups[k] ||= []).push(b) })

  return (
    <>
      <PageHeader title="Weekly report" subtitle="Approved FCRs per KAM for the week. The Friday email contains the same information."
        actions={<>
          <div className="flex items-center gap-1">
            <button className="btn-secondary w-8 px-0" onClick={() => go(-1)} aria-label="Previous week"><ChevronLeft size={15} /></button>
            <span className="w-48 text-center text-[13px] font-medium tabular-nums">{fmt(start, 'MMM d')} – {fmt(end, 'MMM d, yyyy')}</span>
            <button className="btn-secondary w-8 px-0" onClick={() => go(1)} aria-label="Next week"><ChevronRight size={15} /></button>
          </div>
          <button className="btn-primary" onClick={download} disabled={!data || Boolean(progress)}>
            <Download size={14} /> {progress ? `Building ${progress[0]}/${progress[1]}…` : 'Download PDFs (.zip)'}
          </button>
        </>} />
      {!data ? <Spinner /> : data.branch.length === 0 ? <div className="panel"><Empty title="No team members in your branch" /></div> : (
        <div className="space-y-5">
          {Object.entries(groups).map(([sup, members]) => {
            const total = members.reduce((n, m) => n + data.fcrs.filter((f) => f.owner_id === m.id).length, 0)
            return (
              <div key={sup} className="panel">
                <div className="panel-head"><span className="panel-title">{sup}'s team</span><span className="text-[12px] text-ink-3">{total} approved visit{total === 1 ? '' : 's'}</span></div>
                <table className="tbl">
                  <thead><tr><th className="w-56">KAM</th><th className="num w-24">Approved</th><th>Visits</th></tr></thead>
                  <tbody>
                    {members.map((m) => {
                      const list = data.fcrs.filter((f) => f.owner_id === m.id)
                      return (
                        <tr key={m.id}>
                          <td className={`font-medium align-top ${list.length ? '' : 'text-bad'}`}>{m.full_name}</td>
                          <td className={`num align-top font-semibold ${list.length ? '' : 'text-bad'}`}>{list.length}</td>
                          <td className="text-ink-2">
                            {list.length === 0 ? 'No approved FCRs' : list.map((f) => (
                              <button key={f.id} className="block text-left hover:text-accent" onClick={() => navigate(`/fcr/${f.id}`)}>
                                <span className="tabular-nums text-ink-3">{fmt(f.visit_date, 'EEE MMM d')} {f.period}</span> · {f.customer_info?.company_name}
                              </button>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
