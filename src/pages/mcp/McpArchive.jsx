import { useEffect, useMemo, useState } from 'react'
import { FileDown, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProfiles } from '../../lib/data'
import { fmt, fmtDateTime } from '../../lib/dates'
import { downloadSnapshotPdf } from '../../lib/lazy'
import { PageHeader, Spinner, Empty } from '../../components/ui'

// Immutable snapshots saved by "Generate and export PDF" on MCP Actual.
export function McpArchive() {
  const { byId } = useProfiles()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.from('mcp_archive').select('*').order('month', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [])
  const filtered = useMemo(() => (rows || []).filter((r) => {
    const s = q.trim().toLowerCase()
    return !s || [r.snapshot?.owner?.full_name, r.snapshot?.owner?.team, fmt(r.month, 'MMMM yyyy')].some((v) => String(v || '').toLowerCase().includes(s))
  }), [rows, q])

  return (
    <>
      <PageHeader title="MCP Archive" subtitle="Saved MCP Actual reports. Each is a snapshot taken when it was generated." />
      <div className="panel">
        <div className="p-3 border-b border-line">
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <input className="input pl-8" placeholder="Name, team or month" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {!rows ? <Spinner /> : filtered.length === 0 ? <Empty title="No archived reports yet">Use "Generate and export PDF" on MCP Actual.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Month</th><th>KAM</th><th>Team</th><th className="num">Approved visits</th><th className="num">Planned</th><th>Generated</th><th>By</th><th /></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{fmt(r.month, 'MMMM yyyy')}</td>
                    <td>{r.snapshot?.owner?.full_name}</td>
                    <td className="text-ink-2">{r.snapshot?.owner?.team}</td>
                    <td className="num">{(r.snapshot?.visits || []).length}</td>
                    <td className="num">{r.snapshot?.planned_count ?? ''}</td>
                    <td className="text-ink-2">{fmtDateTime(r.created_at)}</td>
                    <td className="text-ink-2">{byId[r.generated_by]?.full_name}</td>
                    <td className="text-right"><button className="btn-ghost" onClick={() => downloadSnapshotPdf(r.snapshot, `MCP Actual ${r.month.slice(0, 7)} - ${r.snapshot?.owner?.full_name || ''}.pdf`)}><FileDown size={14} /> PDF</button></td>
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
