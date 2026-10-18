import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, FileText, Archive } from 'lucide-react'
import { startOfMonth } from 'date-fns'
import { fetchFilers, fetchReportFcrs, fetchArchives, useProfiles, downloadBlob } from '../../lib/data'
import { ymd, fmt, monthsBetween } from '../../lib/dates'
import { saveExportWorkbook, combinedFcrPdf, reportZip } from '../../lib/lazy'
import { PageHeader, Field } from '../../components/ui'

// Any date range, any KAM in your branch: styled Excel workbook, one combined
// PDF, or a zip of individual PDFs. All RLS-scoped.
export function ExportCenter() {
  const { byId } = useProfiles()
  const [branch, setBranch] = useState([])
  const [from, setFrom] = useState(ymd(startOfMonth(new Date())))
  const [to, setTo] = useState(ymd(new Date()))
  const [kam, setKam] = useState('')
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => { fetchFilers().then((b) => setBranch(b.sort((x, y) => x.full_name.localeCompare(y.full_name)))) }, [])

  const ownerIds = kam ? [kam] : branch.map((b) => b.id)
  const scopeLabel = kam ? byId[kam]?.full_name : 'All KAMs in your branch'
  const get = () => fetchReportFcrs({ from, to, ownerIds, approvedOnly, byId })

  const run = async (kind) => {
    if (from > to) { toast.error('"From" is after "To"'); return }
    setBusy(kind)
    try {
      const fcrs = await get()
      const tag = `${from} to ${to}${kam ? ` - ${byId[kam]?.full_name}` : ''}`
      if (kind === 'xlsx') {
        const archives = await fetchArchives({ from, to, ownerIds })
        await saveExportWorkbook({ fcrs, archives, from, to, scopeLabel }, `ACS Export ${tag}.xlsx`)
      } else if (kind === 'pdf') {
        if (!fcrs.length) { toast.message('No acknowledged FCRs in this range'); return }
        downloadBlob(await combinedFcrPdf(fcrs), `ACS FCRs ${tag}.pdf`)
      } else {
        downloadBlob(await reportZip({ fcrs, ownerIds, byId, months: monthsBetween(from, to) }), `ACS Report ${tag}.zip`)
      }
      toast.success(`${fcrs.length} FCR${fcrs.length === 1 ? '' : 's'} exported`)
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  return (
    <>
      <PageHeader title="Export center" subtitle="Download customer-acknowledged FCRs and MCP Actual for any period." />
      <div className="panel p-5 max-w-3xl space-y-5">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="KAM">
            <select className="input" value={kam} onChange={(e) => setKam(e.target.value)}>
              <option value="">All in my branch ({branch.length})</option>
              {branch.map((b) => <option key={b.id} value={b.id}>{b.full_name}{b.team ? ` (${b.team})` : ''}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} /> Approved FCRs only (otherwise all customer-acknowledged FCRs)</label>
        <div className="grid sm:grid-cols-3 gap-3 pt-4 border-t border-line">
          <button className="btn-secondary h-auto py-3 flex-col items-start text-left" onClick={() => run('xlsx')} disabled={Boolean(busy)}>
            <span className="flex items-center gap-1.5 font-semibold"><FileSpreadsheet size={15} /> {busy === 'xlsx' ? 'Building…' : 'Excel workbook'}</span>
            <span className="text-[12px] text-ink-3 font-normal whitespace-normal">Summary by KAM, FCR list, programs, competitive, AR, projects, sub-dealers, MCP archive.</span>
          </button>
          <button className="btn-secondary h-auto py-3 flex-col items-start text-left" onClick={() => run('pdf')} disabled={Boolean(busy)}>
            <span className="flex items-center gap-1.5 font-semibold"><FileText size={15} /> {busy === 'pdf' ? 'Building…' : 'Combined PDF'}</span>
            <span className="text-[12px] text-ink-3 font-normal whitespace-normal">Every FCR in the ACS form layout, in one file.</span>
          </button>
          <button className="btn-secondary h-auto py-3 flex-col items-start text-left" onClick={() => run('zip')} disabled={Boolean(busy)}>
            <span className="flex items-center gap-1.5 font-semibold"><Archive size={15} /> {busy === 'zip' ? 'Building…' : 'Zip of PDFs'}</span>
            <span className="text-[12px] text-ink-3 font-normal whitespace-normal">One PDF per FCR, by KAM, plus MCP Actual per month.</span>
          </button>
        </div>
        <p className="text-[12px] text-ink-4">Period {fmt(from)} to {fmt(to)} · by visit date · generated in your browser, nothing is uploaded.</p>
      </div>
    </>
  )
}
