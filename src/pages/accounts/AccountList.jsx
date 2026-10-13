import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAccounts, useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt } from '../../lib/dates'
import { PageHeader, Spinner, Empty, Segmented } from '../../components/ui'

export function AccountList() {
  const { canWrite, canFile, user } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState(null)
  const [lastVisit, setLastVisit] = useState({})
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const [scope, setScope] = useState(canFile ? 'mine' : 'all')

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]))
    // Last approved visit per account the user can see.
    supabase.from('fcrs').select('account_id, visit_date').eq('status', 'approved').order('visit_date', { ascending: false }).limit(5000)
      .then(({ data }) => {
        const m = {}
        ;(data || []).forEach((r) => { if (!m[r.account_id]) m[r.account_id] = r.visit_date })
        setLastVisit(m)
      })
  }, [])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (accounts || []).filter((a) =>
      (type === 'all' || a.account_type === type) &&
      (scope === 'all' || a.kam_id === user.id) &&
      (!s || [a.company_name, a.owners, a.region, a.business_address, byId[a.kam_id]?.full_name].some((v) => String(v || '').toLowerCase().includes(s))))
  }, [accounts, q, type, scope, user, byId])

  return (
    <>
      <PageHeader title="Accounts" subtitle="Customer master shared by the ACS team. Profile an account once; every FCR and MCP Plan uses it."
        actions={canWrite && <Link to="/accounts/new" className="btn-primary"><Plus size={15} /> New account</Link>} />
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <input className="input pl-8" placeholder="Search company, owner, region, KAM" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented value={scope} onChange={setScope} options={[{ value: 'mine', label: 'My accounts' }, { value: 'all', label: 'All' }]} />
          <Segmented value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, { value: 'dealer', label: 'Dealers' }, { value: 'sub_dealer', label: 'Sub-dealers' }]} />
          <span className="ml-auto text-[12px] text-ink-3 tabular-nums">{rows.length} account{rows.length === 1 ? '' : 's'}</span>
        </div>
        {!accounts ? <Spinner /> : rows.length === 0 ? (
          <Empty title={scope === 'mine' ? 'No accounts assigned to you yet' : 'No accounts match'}>
            {scope === 'mine' ? 'Switch to "All" to find an existing account, or profile a new one.' : 'Try a different search.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th>Company</th><th>Type</th><th>Region</th><th>Classification / Dealer</th><th>KAM</th><th className="num">Visit freq</th><th>Last approved visit</th>
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => navigate(`/accounts/${a.id}`)}>
                    <td className="font-medium">{a.company_name}{a.priority && <span className="ml-2 chip-info">{a.priority}</span>}</td>
                    <td>{a.account_type === 'sub_dealer' ? 'Sub-dealer' : 'Dealer'}</td>
                    <td className="text-ink-2">{a.region}</td>
                    <td className="text-ink-2">{a.account_type === 'sub_dealer' ? (accounts.find((p) => p.id === a.parent_dealer_id)?.company_name || '—') : a.dealer_classification}</td>
                    <td className="text-ink-2">{byId[a.kam_id]?.full_name || <span className="text-bad">Unassigned</span>}</td>
                    <td className="num">{a.visit_freq_days}</td>
                    <td className="text-ink-2 tabular-nums">{fmt(lastVisit[a.id]) || <span className="text-ink-4">None</span>}</td>
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
