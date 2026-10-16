import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Upload, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react'
import { supabase, rpc } from '../../lib/supabase'
import { readWorkbookRows } from '../../lib/lazy'
import { parsePlan, planPayload, parseDsr, fmtPeso, MONTHS } from '../../lib/targetImport'
import { monthName } from '../../lib/targets'
import { fmtDateTime, todayYmd } from '../../lib/dates'
import { PageHeader, Segmented, Field, Spinner, Empty, Modal, confirm } from '../../components/ui'

// Admin > Targets and sales. The two official uploads:
//   TTA plan  -> dealers (by BP code), monthly owner and target
//   Final DSR -> "Actual Sales" per BP code for one month
// Files are read in the browser; the database re-validates everything in
// import_target_plan / import_sales_actuals and writes all-or-nothing.

const thisMonth = () => `${todayYmd().slice(0, 7)}-01`
const lastMonth = () => {
  const [y, m] = todayYmd().split('-').map(Number)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}
const ERROR_TEXT = {
  bad_bp_code: (e) => `Invalid BP code "${e.bp_code ?? ''}"${e.account ? ` (${e.account})` : ''}`,
  negative: (e) => `Negative target for BP ${e.bp_code} in ${monthName(e.month)}`,
  unknown_kam: (e) => `"${e.kam_label}" is not mapped to a person yet. Map it below.`,
  two_owners: (e) => `BP ${e.bp_code} has two KAMs in ${monthName(e.month)}: ${(e.kams || []).join(', ')}`,
  two_names: (e) => `BP ${e.bp_code} has two account names: ${(e.names || []).join(', ')}`,
  name_taken: (e) => `"${e.account}" (BP ${e.bp_code}) is already the name of BP ${e.other_bp_code} in the app`,
  kam_not_on_roster: (e) => `"${e.kam_label}" maps to ${e.email}, who is not on the org roster`,
  duplicate_bp_code: (e) => `BP ${e.bp_code} appears twice`,
}
const errText = (e) => (ERROR_TEXT[e.type] ? ERROR_TEXT[e.type](e) : JSON.stringify(e))

function Kv({ items }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line rounded overflow-hidden">
      {items.map(([k, v]) => (
        <div key={k} className="bg-white px-3 py-2">
          <dt className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3">{k}</dt>
          <dd className="text-[15px] font-semibold tabular-nums mt-0.5">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Notes({ title, items, tone = 'warn' }) {
  if (!items?.length) return null
  const cls = tone === 'bad' ? 'border-bad/30 bg-bad-soft text-bad' : 'border-warn/30 bg-warn-soft text-warn'
  return (
    <div className={`rounded border px-3 py-2 text-[13px] ${cls}`}>
      <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> {title}</p>
      <ul className="mt-1 space-y-0.5 text-ink-2 list-disc pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}

function FilePick({ onFile, accept = '.csv,.xlsx,.xls', label = 'Choose file' }) {
  return (
    <label className="btn-secondary cursor-pointer">
      <Upload size={14} /> {label}
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
    </label>
  )
}

// ---------------------------------------------------------------------------
// TTA plan
// ---------------------------------------------------------------------------

function PlanUpload({ roster, stamp, onApplied, onAliasesChanged }) {
  const year = Number(todayYmd().slice(0, 4))
  const [planYear, setPlanYear] = useState(year)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [server, setServer] = useState(null)
  const [effective, setEffective] = useState(thisMonth())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [viewMonth, setViewMonth] = useState(thisMonth().slice(5, 7))
  const [hasPlan, setHasPlan] = useState(false)

  useEffect(() => {
    supabase.from('account_targets').select('bp_code', { count: 'exact', head: true }).gte('month', `${planYear}-01-01`).lte('month', `${planYear}-12-01`)
      .then(({ count }) => setHasPlan((count || 0) > 0))
  }, [planYear, stamp])

  // First load of a year replaces everything; later loads replace from this
  // month on unless the admin restates the year.
  const effectiveOptions = useMemo(() => {
    const opts = [{ value: `${planYear}-01-01`, label: hasPlan ? 'January (restate the whole year)' : 'January (whole year)' }]
    const cur = thisMonth()
    if (hasPlan && cur.startsWith(String(planYear))) {
      for (let m = Number(cur.slice(5, 7)); m <= 12; m++) {
        const v = `${planYear}-${String(m).padStart(2, '0')}-01`
        if (v !== opts[0].value) opts.push({ value: v, label: `${monthName(v)} to December` })
      }
    }
    return opts
  }, [planYear, hasPlan])
  // Default: whole year on the first load, otherwise this month onward.
  useEffect(() => { setEffective((effectiveOptions[1] || effectiveOptions[0]).value) }, [effectiveOptions])
  const restating = hasPlan && effective === `${planYear}-01-01` && `${planYear}-01-01` < thisMonth()

  const dryRun = useCallback(async (p = parsed, eff = effective) => {
    if (!p) return
    setBusy('check')
    try { setServer(await rpc('import_target_plan', { p_year: planYear, p_rows: planPayload(p), p_file_name: file?.name, p_effective_from: eff, p_reason: reason || null, p_dry_run: true })) }
    catch (e) { setServer(null); toast.error(e.message) } finally { setBusy('') }
  }, [parsed, effective, planYear, file, reason])

  const onFile = async (f) => {
    setFile(f); setParsed(null); setServer(null)
    setBusy('read')
    try {
      const sheets = await readWorkbookRows(f)
      let p = null; let lastErr = null
      for (const s of sheets) { try { p = parsePlan(s.rows); break } catch (e) { lastErr = e } }
      if (!p) throw lastErr
      setParsed(p)
      setBusy('')
      await dryRun(p)
    } catch (e) { toast.error(e.message); setBusy('') }
  }

  useEffect(() => { if (parsed) dryRun() }, [effective, planYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (restating && !reason.trim()) { toast.error('Give a reason for restating months already past'); return }
    const ok = await confirm({
      title: 'Load this TTA plan?',
      body: `${server.dealers} dealers, ${server.dealer_months} dealer-months, ${fmtPeso(server.total)} from ${monthName(server.effective_from)} to December ${planYear}. Months before that are kept. KAMs see the new allocation immediately.`,
      confirmLabel: 'Load plan',
    })
    if (!ok) return
    setBusy('apply')
    try {
      const r = await rpc('import_target_plan', { p_year: planYear, p_rows: planPayload(parsed), p_file_name: file?.name, p_effective_from: effective, p_reason: reason || null, p_dry_run: false })
      if (!r.applied) { setServer(r); toast.error('Not loaded: fix the issues listed'); return }
      toast.success(`Plan loaded: ${r.dealers} dealers`)
      setParsed(null); setServer(null); setFile(null); setReason('')
      onApplied()
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  const allocation = useMemo(() => {
    if (!parsed) return []
    const i = Number(viewMonth) - 1
    const by = new Map()
    for (const r of parsed.rows) {
      const v = r.months[i]
      if (v == null) continue
      const cur = by.get(r.kam_label) || { kam: r.kam_label, dealers: 0, target: 0 }
      cur.dealers += 1; cur.target += v
      by.set(r.kam_label, cur)
    }
    return [...by.values()].sort((a, b) => b.target - a.target)
  }, [parsed, viewMonth])

  const unknown = (server?.errors || []).filter((e) => e.type === 'unknown_kam').map((e) => e.kam_label)
  const blocking = [
    ...(parsed?.warnings || []).filter((w) => w.blocking).map((w) => w.text),
    ...(server?.errors || []).filter((e) => e.type !== 'unknown_kam').map(errText),
  ]
  const notes = (parsed?.warnings || []).filter((w) => !w.blocking).map((w) => w.text)
  const ownerNotKam = (server?.warnings?.owner_not_kam || []).map((w) => `${w.kam_label} (${w.role.toUpperCase()}) holds ${w.dealers} dealer${w.dealers === 1 ? '' : 's'}. Only KAMs file FCRs, so these dealers get no FCRs until reassigned in the plan.`)
  const unassigned = (server?.warnings?.unassigned || []).map((w) => `${w.kam_label}: ${w.dealers} dealer${w.dealers === 1 ? '' : 's'} with no KAM in the app (${w.status === 'vacant' ? 'vacant' : 'not in the app'}). They count in team totals and appear in nobody's dropdown.`)
  const canApply = parsed && server && !busy && !blocking.length && !unknown.length

  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">TTA plan: dealers, monthly KAM and target</span></div>
      <div className="p-4 space-y-4">
        <p className="text-[13px] text-ink-3 max-w-3xl">Upload the ACS Master Monitoring (TTA plan) file as CSV or Excel. Each row is a dealer and the KAM who holds it; a month with a value is that KAM's month. Dealers are matched by BP code; a dealer already in the app under the same account name and without a BP code is linked, not duplicated.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Plan year">
            <select className="input w-28" value={planYear} onChange={(e) => setPlanYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Replace months">
            <select className="input w-72" value={effective} onChange={(e) => setEffective(e.target.value)}>
              {effectiveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <FilePick onFile={onFile} label={file ? 'Choose another file' : 'Choose plan file'} />
          {file && <span className="text-[12px] text-ink-3 pb-2">{file.name}</span>}
        </div>
        {restating && (
          <Field label="Reason for restating past months *" className="max-w-2xl">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approved revised TTA, memo dated ..." />
          </Field>
        )}

        {busy === 'read' && <Spinner label="Reading file" />}
        {parsed && (
          <>
            <Kv items={[
              ['Dealers (BP codes)', parsed.dealers],
              ['Plan rows', parsed.rows.length],
              ['Change KAM in the year', parsed.handovers],
              ['FY total', fmtPeso(parsed.total)],
            ]} />
            {server && (
              <Kv items={[
                ['New dealers', server.new_dealers],
                ['Linked to existing', server.linked_existing],
                ['Already in the app', server.updated_dealers],
                [`Replaced from ${monthName(server.effective_from).split(' ')[0]}`, `${server.dealer_months} rows`],
              ]} />
            )}
            <Notes title="Fix before loading" tone="bad" items={blocking} />
            {unknown.length > 0 && <AliasMapper labels={unknown} roster={roster} onSaved={async () => { onAliasesChanged(); await dryRun() }} />}
            <Notes title="Check" items={[...ownerNotKam, ...unassigned]} />
            <Notes title="File notes (not blocking)" items={notes} />

            <div className="border border-line rounded">
              <div className="flex items-center justify-between px-3 h-10 border-b border-line">
                <span className="text-[13px] font-semibold">Allocation by KAM</span>
                <select className="input h-7 w-32" value={viewMonth} onChange={(e) => setViewMonth(e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                </select>
              </div>
              <div className="overflow-x-auto max-h-[360px]">
                <table className="tbl">
                  <thead><tr><th>Name in file</th><th className="!text-right">Dealers</th><th className="!text-right">Target (PHP)</th></tr></thead>
                  <tbody>
                    {allocation.map((a) => (
                      <tr key={a.kam}><td>{a.kam}</td><td className="text-right tabular-nums">{a.dealers}</td><td className="text-right tabular-nums">{a.target.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{allocation.reduce((s, a) => s + a.dealers, 0)}</td><td className="px-3 py-2 text-right tabular-nums">{allocation.reduce((s, a) => s + a.target, 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}</td></tr></tfoot>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {busy === 'check' && <span className="text-[12px] text-ink-3">Checking against the app…</span>}
              <button className="btn-primary" disabled={!canApply} onClick={apply}>{busy === 'apply' ? 'Loading…' : 'Load plan'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AliasMapper({ labels, roster, onSaved }) {
  const [map, setMap] = useState({})
  const [busy, setBusy] = useState(false)
  const kams = roster.filter((r) => r.active)
  const save = async () => {
    setBusy(true)
    try {
      for (const l of labels) {
        const v = map[l]
        if (!v) continue
        if (v === 'vacant' || v === 'not_in_app') await rpc('set_kam_alias', { p_alias: l, p_status: v })
        else await rpc('set_kam_alias', { p_alias: l, p_status: 'kam', p_email: v })
      }
      toast.success('Names mapped')
      await onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="border border-line rounded p-3 space-y-2">
      <p className="text-[13px] font-semibold">Map plan names to people</p>
      <p className="text-[12px] text-ink-3">The plan uses short names. Map each one once; later uploads reuse the map.</p>
      {labels.map((l) => (
        <div key={l} className="grid sm:grid-cols-[220px_1fr] gap-2 items-center">
          <span className="text-[13px] font-medium">{l}</span>
          <select className="input" value={map[l] || ''} onChange={(e) => setMap((m) => ({ ...m, [l]: e.target.value }))}>
            <option value="">Choose…</option>
            <option value="vacant">Vacant (no KAM)</option>
            <option value="not_in_app">Not in the app (history only)</option>
            {kams.map((r) => <option key={r.email} value={r.email}>{r.full_name} · {r.position || r.role}</option>)}
          </select>
        </div>
      ))}
      <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy || !labels.some((l) => map[l])}>Save and re-check</button></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Final DSR
// ---------------------------------------------------------------------------

function DsrUpload({ onApplied }) {
  const [month, setMonth] = useState(lastMonth().slice(0, 7))
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [server, setServer] = useState(null)
  const [busy, setBusy] = useState('')
  const mon = `${month}-01`

  const check = async (p = parsed, m = mon) => {
    if (!p) return
    setBusy('check')
    try { setServer(await rpc('import_sales_actuals', { p_month: m, p_rows: p.rows, p_file_name: file?.name, p_dry_run: true })) }
    catch (e) { setServer(null); toast.error(e.message) } finally { setBusy('') }
  }

  const onFile = async (f) => {
    setFile(f); setParsed(null); setServer(null); setBusy('read')
    try {
      const sheets = await readWorkbookRows(f)
      let p = null; let lastErr = null; let sheet = null
      for (const s of sheets) { try { p = parseDsr(s.rows); sheet = s.name; break } catch (e) { lastErr = e } }
      if (!p) throw lastErr
      setParsed({ ...p, sheet })
      setBusy('')
      await check({ ...p, sheet })
    } catch (e) { toast.error(e.message); setBusy('') }
  }

  useEffect(() => { if (parsed) check() }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    const ok = await confirm({
      title: `Load the final DSR for ${monthName(mon)}?`,
      body: `${parsed.rows.length} BP codes, ${fmtPeso(parsed.total)} actual sales.${server?.replaces_existing ? ` This replaces the ${monthName(mon)} sales already loaded.` : ''}`,
      confirmLabel: 'Load sales',
    })
    if (!ok) return
    setBusy('apply')
    try {
      const r = await rpc('import_sales_actuals', { p_month: mon, p_rows: parsed.rows, p_file_name: file?.name, p_dry_run: false })
      if (!r.applied) { setServer(r); toast.error('Not loaded: fix the issues listed'); return }
      toast.success(`${monthName(mon)} sales loaded`)
      setParsed(null); setServer(null); setFile(null)
      onApplied()
    } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }

  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Final DSR: official monthly sales</span></div>
      <div className="p-4 space-y-4">
        <p className="text-[13px] text-ink-3 max-w-3xl">Upload the final DSR of a month. The app reads the <strong className="text-ink-2">BP Code</strong> and <strong className="text-ink-2">Actual Sales</strong> columns and sums Actual Sales per BP code. Loading a month again replaces that month.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Sales month">
            <input type="month" className="input w-44" max={todayYmd().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <FilePick onFile={onFile} label={file ? 'Choose another file' : 'Choose DSR file'} />
          {file && <span className="text-[12px] text-ink-3 pb-2">{file.name}</span>}
        </div>
        {busy === 'read' && <Spinner label="Reading file" />}
        {parsed && (
          <>
            <p className="text-[12px] text-ink-3">Read sheet <strong className="text-ink-2">{parsed.sheet}</strong>, header on line {parsed.columns.headerLine}: BP column "{parsed.columns.bp}", amount column "{parsed.columns.amount}".</p>
            <Kv items={[
              ['DSR lines', parsed.lines],
              ['BP codes', parsed.rows.length],
              ['Actual sales', fmtPeso(parsed.total)],
              ['ACS dealers in file', server ? `${server.in_plan} · ${fmtPeso(server.in_plan_total)}` : '…'],
            ]} />
            {server?.replaces_existing && <Notes title="Replaces" items={[`${monthName(mon)} sales are already loaded. Loading this file replaces them.`]} />}
            <Notes title="Fix before loading" tone="bad" items={(server?.errors || []).map(errText)} />
            <Notes title="Skipped lines" items={parsed.warnings.slice(0, 20).map((w) => w.text).concat(parsed.warnings.length > 20 ? [`and ${parsed.warnings.length - 20} more`] : [])} />
            <div className="flex justify-end gap-2">
              {busy === 'check' && <span className="text-[12px] text-ink-3">Checking…</span>}
              <button className="btn-primary" disabled={!server || Boolean(busy) || (server.errors || []).length > 0} onClick={apply}>{busy === 'apply' ? 'Loading…' : 'Load sales'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Names and history
// ---------------------------------------------------------------------------

function Aliases({ aliases, roster, onChanged }) {
  const [edit, setEdit] = useState(null)
  const byEmail = Object.fromEntries(roster.map((r) => [r.email.toLowerCase(), r]))
  const save = async () => {
    try {
      await rpc('set_kam_alias', { p_alias: edit.alias, p_status: edit.value === 'vacant' || edit.value === 'not_in_app' ? edit.value : 'kam', p_email: ['vacant', 'not_in_app'].includes(edit.value) ? null : edit.value })
      toast.success('Saved. Load the plan again to apply the change to its months.')
      setEdit(null); onChanged()
    } catch (e) { toast.error(e.message) }
  }
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Plan names</span><span className="text-[12px] text-ink-3">How names in the TTA plan map to people</span></div>
      {!aliases ? <Spinner /> : aliases.length === 0 ? <Empty title="No names mapped yet">They are mapped on the first plan upload.</Empty> : (
        <table className="tbl">
          <thead><tr><th>Name in plan</th><th>Person</th><th>Role</th><th /></tr></thead>
          <tbody>
            {aliases.map((a) => {
              const r = a.email ? byEmail[a.email.toLowerCase()] : null
              return (
                <tr key={a.alias}>
                  <td className="font-medium">{a.alias}</td>
                  <td>{a.status === 'kam' ? (r?.full_name || a.email) : <span className="text-ink-3">{a.status === 'vacant' ? 'Vacant' : 'Not in the app'}</span>}</td>
                  <td className={r && r.role !== 'kam' ? 'text-warn' : 'text-ink-2'}>{r ? r.role.toUpperCase() : ''}{r && r.role !== 'kam' ? ' · cannot file' : ''}</td>
                  <td className="text-right"><button className="btn-ghost h-7" onClick={() => setEdit({ alias: a.alias, value: a.status === 'kam' ? a.email : a.status })}><Pencil size={13} /> Change</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`Map "${edit?.alias || ''}"`}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        {edit && (
          <select className="input" value={edit.value || ''} onChange={(e) => setEdit({ ...edit, value: e.target.value })}>
            <option value="vacant">Vacant (no KAM)</option>
            <option value="not_in_app">Not in the app (history only)</option>
            {roster.filter((r) => r.active).map((r) => <option key={r.email} value={r.email}>{r.full_name} · {r.position || r.role}</option>)}
          </select>
        )}
        <p className="text-[12px] text-ink-3 mt-2">Existing months keep their owner until the plan is loaded again.</p>
      </Modal>
    </div>
  )
}

function History({ imports, byId }) {
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Upload history</span></div>
      {!imports ? <Spinner /> : imports.length === 0 ? <Empty title="Nothing uploaded yet" /> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>When</th><th>Upload</th><th>Period</th><th>File</th><th className="!text-right">BP codes</th><th className="!text-right">Amount (PHP)</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap tabular-nums">{fmtDateTime(i.created_at)}</td>
                  <td>{i.kind === 'target_plan' ? 'TTA plan' : 'Final DSR'}</td>
                  <td className="whitespace-nowrap">{i.kind === 'target_plan' ? `${monthName(i.effective_from).split(' ')[0]}–Dec ${i.plan_year}` : monthName(i.sales_month)}</td>
                  <td className="text-ink-2 max-w-[220px] truncate">{i.file_name}</td>
                  <td className="text-right tabular-nums">{i.account_count}</td>
                  <td className="text-right tabular-nums">{Number(i.total_amount).toLocaleString('en-PH', { maximumFractionDigits: 0 })}</td>
                  <td>{byId[i.imported_by]?.full_name}</td>
                  <td className="text-ink-2">{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Targets() {
  const [tab, setTab] = useState('plan')
  const [roster, setRoster] = useState([])
  const [aliases, setAliases] = useState(null)
  const [imports, setImports] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [stamp, setStamp] = useState(0)

  const loadAliases = useCallback(async () => {
    const { data } = await supabase.from('kam_aliases').select('*').order('alias')
    setAliases(data || [])
  }, [])
  const load = useCallback(async () => {
    const [{ data: r }, { data: i }, { data: p }] = await Promise.all([
      supabase.from('org_roster').select('email, full_name, position, role, active').order('full_name'),
      supabase.from('data_imports').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('user_profiles').select('id, full_name'),
    ])
    setRoster(r || []); setImports(i || [])
    setProfiles(Object.fromEntries((p || []).map((x) => [x.id, x])))
    loadAliases()
  }, [loadAliases])
  useEffect(() => { load() }, [load, stamp])
  const applied = useCallback(() => setStamp((s) => s + 1), [])

  const last = (kind) => imports?.find((i) => i.kind === kind)
  return (
    <>
      <PageHeader title="Targets and sales" subtitle="Official sources: the TTA plan (dealers by BP code, monthly KAM and target) and the final DSR of each month (Actual Sales by BP code)." />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'plan', label: 'TTA plan' }, { value: 'dsr', label: 'Monthly DSR' }, { value: 'names', label: 'Plan names' }, { value: 'history', label: 'History' }]} />
        <span className="text-[12px] text-ink-3 flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-ok" />
          {last('target_plan') ? `Plan loaded ${fmtDateTime(last('target_plan').created_at)}` : 'No plan loaded yet'}
          {' · '}
          {imports?.filter((i) => i.kind === 'sales_dsr').length ? `Latest DSR: ${monthName(imports.filter((i) => i.kind === 'sales_dsr').map((i) => i.sales_month).sort().at(-1))}` : 'No DSR loaded yet'}
        </span>
      </div>
      {tab === 'plan' && <PlanUpload roster={roster} stamp={stamp} onApplied={applied} onAliasesChanged={loadAliases} />}
      {tab === 'dsr' && <DsrUpload onApplied={applied} />}
      {tab === 'names' && <Aliases aliases={aliases} roster={roster} onChanged={loadAliases} />}
      {tab === 'history' && <History imports={imports} byId={profiles} />}
    </>
  )
}
