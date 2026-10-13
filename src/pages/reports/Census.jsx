import { FILER_ROLES } from '../../lib/roles'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet } from 'lucide-react'
import { addDays, addWeeks, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchBranch, useProfiles } from '../../lib/data'
import { fmt, ymd, weekStart, weekEnd, toDate } from '../../lib/dates'
import { saveCensusWorkbook } from '../../lib/lazy'
import { PageHeader, Spinner, Field } from '../../components/ui'

// Weekly visit counts (customer-acknowledged FCRs) for every member of the
// branch, INCLUDING zero-activity members. Weeks are Monday-Sunday and the
// range snaps to whole weeks (MBT silently truncated a week when "From"
// wasn't week-aligned).
export function Census() {
  const { byId } = useProfiles()
  const [from, setFrom] = useState(ymd(addWeeks(weekStart(), -3)))
  const [to, setTo] = useState(ymd(weekEnd()))
  const [data, setData] = useState(null)

  const a = ymd(weekStart(toDate(from)))
  const b = ymd(weekEnd(toDate(to)))
  const weeks = []
  for (let d = toDate(a); ymd(d) <= b; d = addDays(d, 7)) weeks.push({ start: ymd(d), end: ymd(addDays(d, 6)) })

  useEffect(() => {
    if (!Object.keys(byId).length) return
    setData(null)
    ;(async () => {
      const branch = (await fetchBranch()).filter((m) => FILER_ROLES.includes(m.role))
      const ids = branch.map((m) => m.id)
      const { data: fcrs, error } = await supabase.from('fcrs').select('owner_id, visit_date')
        .in('owner_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
        .eq('ack_status', 'acknowledged').gte('visit_date', a).lte('visit_date', b)
      if (error) throw error
      const counts = {}
      ;(fcrs || []).forEach((f) => {
        const w = ymd(weekStart(toDate(f.visit_date)))
        counts[f.owner_id] ||= {}
        counts[f.owner_id][w] = (counts[f.owner_id][w] || 0) + 1
      })
      const members = branch.map((m) => ({ ...m, supervisor_name: byId[m.supervisor_id]?.full_name || '' }))
        .sort((x, y) => (x.team || '').localeCompare(y.team || '') || x.supervisor_name.localeCompare(y.supervisor_name) || x.full_name.localeCompare(y.full_name))
      setData({ members, counts })
    })().catch((e) => { toast.error(e.message); setData({ members: [], counts: {} }) })
  }, [a, b, byId])

  const exportXlsx = () => saveCensusWorkbook({ weeks, members: data.members, counts: data.counts, from: a, to: b }, `ACS Visitation Census ${a} to ${b}.xlsx`)

  return (
    <>
      <PageHeader title="Visitation census" subtitle="Customer-acknowledged visits per person per week (Monday to Sunday). Zero weeks in red."
        actions={<button className="btn-secondary" onClick={exportXlsx} disabled={!data}><FileSpreadsheet size={14} /> Excel</button>} />
      <div className="panel">
        <div className="flex flex-wrap items-end gap-3 p-3 border-b border-line">
          <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <p className="text-[12px] text-ink-3 pb-2">Showing whole weeks {fmt(a, 'MMM d')} – {fmt(b, 'MMM d, yyyy')}</p>
        </div>
        {!data ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Team</th><th>Name</th>{weeks.map((w) => <th key={w.start} className="num whitespace-nowrap">{format(toDate(w.start), 'MMM d')}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                {data.members.map((m) => {
                  const total = weeks.reduce((s, w) => s + (data.counts[m.id]?.[w.start] || 0), 0)
                  return (
                    <tr key={m.id}>
                      <td className="text-ink-2">{m.team}</td>
                      <td className="font-medium whitespace-nowrap">{m.full_name}</td>
                      {weeks.map((w) => { const n = data.counts[m.id]?.[w.start] || 0; return <td key={w.start} className={`num ${n === 0 ? 'text-bad font-semibold' : ''}`}>{n}</td> })}
                      <td className="num font-semibold">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
