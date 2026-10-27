import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Check, X, RotateCcw } from 'lucide-react'
import { useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt, fmtDateTime } from '../../lib/dates'
import { fetchGetBacks, daysOverdue, effectiveDue, canActOnGetBack } from '../../lib/getBack'
import { DueTag, changeGetBack } from '../../components/GetBackPanel'
import { PageHeader, Spinner, Empty, Segmented, Stat } from '../../components/ui'

// Every get-back item the user may see (RLS): a KAM their own and their
// accounts', an RSM their KAMs', the Channel Head and Director everyone's.
// Promises open when the FCR is approved; the KAM or the RSM closes them.
export function GetBackList() {
  const { user, canWrite } = useAuth()
  const { byId } = useProfiles()
  const [rows, setRows] = useState(null)
  const [view, setView] = useState('open')
  const [kam, setKam] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(() => fetchGetBacks({ limit: 2000 }).then(setRows).catch(() => setRows([])), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener('acs:getback-changed', load)
    return () => window.removeEventListener('acs:getback-changed', load)
  }, [load])

  const all = rows || []
  const open = all.filter((g) => g.status === 'open')
  const overdue = open.filter((g) => daysOverdue(g) > 0)
  const owners = [...new Set(all.map((g) => g.owner_id))].map((id) => byId[id]).filter(Boolean).sort((a, b) => a.full_name.localeCompare(b.full_name))

  const filtered = useMemo(() => all.filter((g) => {
    if (view === 'open' && g.status !== 'open') return false
    if (view === 'overdue' && !(g.status === 'open' && daysOverdue(g) > 0)) return false
    if (view === 'closed' && g.status === 'open') return false
    if (kam && g.owner_id !== kam) return false
    const s = q.trim().toLowerCase()
    return !s || [g.item, g.account?.company_name, byId[g.owner_id]?.full_name].some((v) => String(v || '').toLowerCase().includes(s))
  }).sort((a, b) => (view === 'closed'
    ? String(b.closed_at).localeCompare(String(a.closed_at))
    : daysOverdue(b) - daysOverdue(a) || String(effectiveDue(a)).localeCompare(String(effectiveDue(b))))),
  [all, view, kam, q, byId]) // eslint-disable-line react-hooks/exhaustive-deps

  const canAct = (g) => canActOnGetBack(g, { userId: user.id, byId, accountKamId: g.account?.kam_id, canWrite })
  const closedThisWeek = all.filter((g) => g.status === 'done' && g.closed_at && Date.now() - Date.parse(g.closed_at) < 7 * 86400000).length

  return (
    <>
      <PageHeader title="Get-back items" subtitle="Promises the customer confirmed in the minutes. They open when the FCR is approved; the KAM or the RSM marks them done." />
      <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
        <Stat label="Open" value={open.length} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'bad' : undefined} />
        <Stat label="Done in the last 7 days" value={closedThisWeek} />
      </div>
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <Segmented value={view} onChange={setView} options={[
            { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' },
          ]} />
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <input className="input pl-8" placeholder="Item, account, KAM" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {owners.length > 1 && (
            <select className="input w-auto" value={kam} onChange={(e) => setKam(e.target.value)} aria-label="KAM">
              <option value="">All KAMs</option>
              {owners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          )}
          <span className="ml-auto text-[12px] text-ink-3 tabular-nums">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
        </div>
        {rows === null ? <Spinner /> : filtered.length === 0 ? (
          <Empty title={view === 'overdue' ? 'Nothing overdue' : view === 'open' ? 'No open get-back items' : 'Nothing here'}>
            Items appear when an FCR with get-back items is approved.
          </Empty>
        ) : (<>
          {/* Phones: one card per item, actions within reach. */}
          <ul className="sm:hidden divide-y divide-line">
            {filtered.map((g) => (
              <li key={g.id} className="px-3 py-3">
                <div className="flex items-start gap-2">
                  <p className="text-[13.5px] leading-snug flex-1 min-w-0 break-words">{g.item}</p>
                  <DueTag g={g} />
                </div>
                <p className="text-[12px] text-ink-3 mt-1">
                  {g.account ? <Link className="text-ink-2" to={`/accounts/${g.account_id}`}>{g.account.company_name}</Link> : '—'}
                  {' · '}{byId[g.owner_id]?.full_name || '—'}{' · '}<Link to={`/fcr/${g.fcr_id}`}>promised {fmt(g.promised_on, 'MMM d')}</Link>
                </p>
                {g.status !== 'open' && <p className="text-[12px] text-ink-3 mt-0.5">{byId[g.closed_by]?.full_name || ''} · {fmtDateTime(g.closed_at)}{g.close_note ? ` · ${g.close_note}` : ''}</p>}
                {canAct(g) && (
                  <div className="flex gap-2 mt-2">
                    {g.status === 'open' ? (<>
                      <button className="btn-secondary h-8 text-ok flex-1 justify-center" onClick={() => changeGetBack(g, 'done')}><Check size={14} /> Done</button>
                      <button className="btn-secondary h-8 flex-1 justify-center" onClick={() => changeGetBack(g, 'dropped')}><X size={14} /> Drop</button>
                    </>) : <button className="btn-secondary h-8" onClick={() => changeGetBack(g, 'open')}><RotateCcw size={13} /> Reopen</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-[110px]">Due</th><th>Item</th><th>Account</th><th>KAM</th><th>Promised</th><th>{view === 'closed' || view === 'all' ? 'Closed' : ''}</th><th /></tr></thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap"><DueTag g={g} /></td>
                    <td className="max-w-[360px] whitespace-normal break-words">{g.item}{!g.due_date && <span className="block text-2xs text-ink-4">No due date on the FCR; a week after the visit is assumed</span>}</td>
                    <td>{g.account ? <Link className="hover:text-accent" to={`/accounts/${g.account_id}`}>{g.account.company_name}</Link> : '—'}</td>
                    <td className="whitespace-nowrap">{byId[g.owner_id]?.full_name || '—'}</td>
                    <td className="whitespace-nowrap tabular-nums"><Link className="hover:text-accent" to={`/fcr/${g.fcr_id}`}>{fmt(g.promised_on)}</Link></td>
                    <td className="text-[12px] text-ink-3 max-w-[220px] whitespace-normal">{g.status !== 'open' && <>{byId[g.closed_by]?.full_name || ''} · {fmtDateTime(g.closed_at)}{g.close_note ? <span className="block">{g.close_note}</span> : null}</>}</td>
                    <td className="whitespace-nowrap text-right">
                      {canAct(g) && (g.status === 'open' ? (
                        <>
                          <button className="btn-ghost h-7 px-2 text-[12px] text-ok" onClick={() => changeGetBack(g, 'done')}><Check size={13} /> Done</button>
                          <button className="btn-ghost h-7 px-2 text-[12px] text-ink-3" onClick={() => changeGetBack(g, 'dropped')}><X size={13} /> Drop</button>
                        </>
                      ) : (
                        <button className="btn-ghost h-7 px-2 text-[12px] text-ink-3" onClick={() => changeGetBack(g, 'open')}><RotateCcw size={12} /> Reopen</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </div>
    </>
  )
}
