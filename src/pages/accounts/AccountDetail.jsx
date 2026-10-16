import { Fragment, useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Lightbulb } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProfiles } from '../../lib/data'
import { useAuth } from '../../context/AuthContext'
import { fmt } from '../../lib/dates'
import { peso, templateFor } from '../../lib/fcrTemplates'
import { buildSuggestions } from '../../lib/fcrSuggestions'
import { fetchPerformance, performanceSnapshot } from '../../lib/targets'
import { PerformanceTable } from '../../components/Performance'
import { todayYmd } from '../../lib/dates'
import { PageHeader, Spinner, StatusChip, AckChip, Empty } from '../../components/ui'

export function AccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canWrite, canFile } = useAuth()
  const { byId } = useProfiles()
  const [account, setAccount] = useState(null)
  const [parent, setParent] = useState(null)
  const [subs, setSubs] = useState([])
  const [fcrs, setFcrs] = useState([])
  const [year, setYear] = useState(Number(todayYmd().slice(0, 4)))
  const [perf, setPerf] = useState(undefined)

  useEffect(() => {
    if (!account?.bp_code) return
    setPerf(undefined)
    fetchPerformance(account.bp_code, year)
      .then((p) => setPerf(p && p.months.some((m) => m.target != null || m.actual) ? performanceSnapshot(p, year === Number(todayYmd().slice(0, 4)) ? todayYmd() : `${year}-12-01`) : null))
      .catch(() => setPerf(null))
  }, [account?.bp_code, year])

  useEffect(() => {
    supabase.from('accounts').select('*').eq('id', id).single().then(async ({ data }) => {
      setAccount(data)
      if (data?.parent_dealer_id) supabase.from('accounts').select('id, company_name').eq('id', data.parent_dealer_id).single().then(({ data: p }) => setParent(p))
    })
    supabase.from('accounts').select('id, company_name, region').eq('parent_dealer_id', id).order('company_name').then(({ data }) => setSubs(data || []))
    supabase.from('fcrs').select('id, owner_id, visit_date, period, status, ack_status, template_id, template_version, form_data')
      .eq('account_id', id).order('visit_date', { ascending: false }).then(({ data }) => setFcrs(data || []))
  }, [id])

  if (!account) return <Spinner />
  const approved = fcrs.filter((f) => f.status === 'approved')
  const suggestions = buildSuggestions(approved)
  const info = [
    ['Type', account.account_type === 'sub_dealer' ? 'Sub-dealer' : 'Dealer'],
    account.account_type === 'sub_dealer' ? null : ['BP code', account.bp_code || <span key="nb" className="text-warn">Not linked to the TTA plan</span>],
    account.registered_name ? ['Registered name', account.registered_name] : null,
    account.area ? ['Plan area', account.area] : null,
    ['Owner/s', account.owners], ['Contact no.', account.contact_no], ['Email', account.email],
    ['Address', account.business_address], ['Region', account.region],
    account.account_type === 'sub_dealer'
      ? ['Dealer', parent ? <Link key="p" className="text-accent hover:underline" to={`/accounts/${parent.id}`}>{parent.company_name}</Link> : '—']
      : ['Classification', account.dealer_classification],
    account.account_type === 'sub_dealer' ? null : ['Channel', account.channel],
    [account.account_type === 'sub_dealer' ? 'KAM' : 'KAM this month', byId[account.kam_id]?.full_name], ['Visit freq / days', account.visit_freq_days], ['Priority', account.priority],
    account.account_type === 'sub_dealer' ? null : ['Payment terms', account.payment_terms],
    account.account_type === 'sub_dealer' ? null : ['Credit limit', account.credit_limit != null ? `PHP ${peso(account.credit_limit)}` : ''],
    ['Contact', [account.contact_person, account.contact_designation].filter(Boolean).join(', ')], ['Contact email', account.contact_email],
  ].filter(Boolean)

  return (
    <>
      <PageHeader title={account.company_name}
        subtitle={!account.active ? 'Inactive account' : undefined}
        back={<Link to="/accounts" className="btn-ghost -ml-2 mb-1 text-ink-3"><ArrowLeft size={14} /> Accounts</Link>}
        actions={<>
          {canWrite && <Link to={`/accounts/${id}/edit`} className="btn-secondary"><Pencil size={14} /> Edit</Link>}
          {canFile && account.active && <button className="btn-primary" onClick={() => navigate('/fcr/new', { state: { accountId: id } })}><Plus size={15} /> New FCR</button>}
        </>} />

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {account.bp_code && (
            <div className="panel overflow-hidden">
              <div className="panel-head">
                <span className="panel-title">Target vs actual sales</span>
                <select className="input h-7 w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
                  {[0, -1].map((d) => { const y = Number(todayYmd().slice(0, 4)) + d; return <option key={y}>{y}</option> })}
                </select>
              </div>
              {perf === undefined ? <Spinner /> : perf === null ? <Empty title={`No TTA target for ${year}`}>Targets appear after the admin loads the TTA plan.</Empty> : <PerformanceTable snap={perf} />}
            </div>
          )}
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Visit history</span><span className="text-[12px] text-ink-3">{fcrs.length} FCR{fcrs.length === 1 ? '' : 's'} you can see</span></div>
            {fcrs.length === 0 ? <Empty title="No FCRs yet for this account" /> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Visit</th><th>KAM</th><th>Form</th><th>Customer</th><th>Status</th><th>Get-back items</th></tr></thead>
                  <tbody>
                    {fcrs.map((f) => (
                      <tr key={f.id} className="clickable" onClick={() => navigate(`/fcr/${f.id}`)}>
                        <td className="tabular-nums whitespace-nowrap">{fmt(f.visit_date)} <span className="text-ink-4">{f.period}</span></td>
                        <td>{byId[f.owner_id]?.full_name}</td>
                        <td className="text-ink-2">{templateFor(f.template_id, f.template_version).shortTitle}</td>
                        <td><AckChip status={f.ack_status} /></td>
                        <td><StatusChip status={f.status} /></td>
                        <td className="text-ink-2 max-w-[280px] truncate">{f.form_data?.get_back_items}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {subs.length > 0 && (
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Sub-dealers under this dealer</span></div>
              <table className="tbl"><tbody>
                {subs.map((s) => <tr key={s.id} className="clickable" onClick={() => navigate(`/accounts/${s.id}`)}><td className="font-medium">{s.company_name}</td><td className="text-ink-2">{s.region}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="panel p-4">
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
              {info.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-3">{k}</dt><dd className="min-w-0 break-words">{v || <span className="text-ink-4">—</span>}</dd></Fragment>))}
            </dl>
            {account.notes && <p className="mt-3 pt-3 border-t border-line text-[13px] text-ink-2 whitespace-pre-wrap">{account.notes}</p>}
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title flex items-center gap-1.5"><Lightbulb size={14} /> Suggested discussion points</span></div>
            <div className="p-4">
              {suggestions.length === 0 ? <p className="text-[13px] text-ink-3">Appears after the first approved FCR for this account.</p> : (
                <ul className="space-y-2.5">
                  {suggestions.map((s) => (
                    <li key={s.id} className="text-[13px] leading-snug"><span className="chip-info mr-1.5">{s.category}</span>{s.text}</li>
                  ))}
                </ul>
              )}
              <p className="text-2xs text-ink-4 mt-3">Rule-based summary of this account's past approved FCRs. Not AI-generated.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
