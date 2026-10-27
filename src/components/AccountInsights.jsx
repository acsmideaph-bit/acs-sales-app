import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Lightbulb } from 'lucide-react'
import { fmtDateTime } from '../lib/dates'
import { fetchInsights } from '../lib/getBack'

const CATEGORY_TONE = {
  'Get-back': 'chip-pending', Collection: 'chip-pending', 'Sales gap': 'chip-info', Project: 'chip-info',
  Program: 'chip-draft', Competitor: 'chip-draft', Visit: 'chip-draft',
}

// Priorities for the next contact + what the KAM and the RSM should do to grow
// the account. The list and its order come from rules over the approved FCRs,
// open get-back items and official sales; Gemini writes the wording (see the
// account-insights Edge Function). `fallback` = the old client-side rule list,
// shown only if the function cannot be reached at all.
export function AccountInsights({ accountId, fallback = [], audience = 'both' }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })

  const load = useCallback(async (refresh = false) => {
    if (!accountId) return
    setState((s) => ({ ...s, loading: true, error: null }))
    try { setState({ loading: false, data: await fetchInsights(accountId, refresh), error: null }) }
    catch (e) { setState((s) => ({ loading: false, data: s.data, error: e.message })) }
  }, [accountId])
  useEffect(() => { load() }, [load])
  // A closed get-back item changes the facts; fetch again (cheap when unchanged).
  useEffect(() => {
    const on = () => load()
    window.addEventListener('acs:getback-changed', on)
    return () => window.removeEventListener('acs:getback-changed', on)
  }, [load])

  if (!accountId) return null
  const row = state.data
  const p = row?.payload
  const ai = row?.source === 'gemini'

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title flex items-center gap-1.5"><Lightbulb size={14} /> Priorities for this account</span>
        <span className="flex items-center gap-1.5">
          {row && <span className={ai ? 'chip-info' : 'chip-draft'} title={ai ? `Wording by ${row.model}` : 'Wording from fixed rules'}>{ai ? 'AI-assisted' : 'Rule-based'}</span>}
          <button className="btn-ghost h-7 w-7 px-0" onClick={() => load(true)} disabled={state.loading} aria-label="Refresh priorities" title="Refresh">
            <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} />
          </button>
        </span>
      </div>

      {state.loading && !p && <p className="px-4 py-4 text-[13px] text-ink-3">Reading the approved visits and sales…</p>}

      {!p && !state.loading && (
        <div className="px-4 py-3">
          <p className="text-[12px] text-bad mb-2">Priorities could not be loaded{state.error ? `: ${state.error}` : '.'}</p>
          {fallback.length > 0 && (
            <ul className="space-y-2">
              {fallback.map((s) => <li key={s.id} className="text-[12.5px] leading-snug"><span className="chip-info mr-1">{s.category}</span>{s.text}</li>)}
            </ul>
          )}
        </div>
      )}

      {p && (
        <div className="divide-y divide-line">
          {p.summary && <p className="px-4 py-3 text-[13px] text-ink-2 leading-snug">{p.summary}</p>}

          {p.priorities?.length > 0 ? (
            <ol className="px-4 py-3 space-y-3">
              {p.priorities.map((x, i) => (
                <li key={x.ref} className="grid grid-cols-[18px_1fr] gap-x-1.5">
                  <span className="text-[12px] font-semibold text-ink-4 tabular-nums pt-px">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug">
                      <span className={`${CATEGORY_TONE[x.category] || 'chip-draft'} mr-1.5`}>{x.category}{x.overdue_days > 0 ? ` · ${x.overdue_days}d late` : ''}</span>
                      <span className="font-medium break-words">{x.title}</span>
                    </p>
                    <p className="text-[12.5px] text-ink-2 leading-snug mt-1">{x.why}</p>
                    <p className="text-[12.5px] leading-snug mt-0.5"><span className="font-semibold">Next: </span>{x.action}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-3 text-[13px] text-ink-3">Nothing urgent from the approved visits. Use the plan below to grow the account.</p>
          )}

          <div className="px-4 py-3 space-y-3">
            <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3">Develop this account</p>
            {audience !== 'rsm' && p.develop?.kam?.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold mb-1">KAM</p>
                <ul className="list-disc pl-4 space-y-1 text-[12.5px] leading-snug">{p.develop.kam.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
            {audience !== 'kam' && p.develop?.rsm?.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold mb-1">RSM</p>
                <ul className="list-disc pl-4 space-y-1 text-[12.5px] leading-snug">{p.develop.rsm.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 text-2xs text-ink-4 leading-relaxed">
            {p.note && <p className="text-warn mb-1">{p.note}</p>}
            {state.error && <p className="text-bad mb-1">Refresh failed: {state.error}</p>}
            <p>
              {ai ? 'List and order from the approved FCRs, open get-back items and official sales; wording by Google Gemini. Check before acting: AI can be wrong. Names and contact details are not sent to the AI.' : 'From the approved FCRs, open get-back items and official sales. Not AI-generated.'}
              {' '}Updated {fmtDateTime(row.generated_at)}.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
