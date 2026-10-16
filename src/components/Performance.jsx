import { useEffect, useRef } from 'react'
import { MONTHS } from '../lib/targetImport'
import { monthName, achievement, pct } from '../lib/targets'

// Account target (TTA plan) vs official actual sales (final DSR), by month.
// Used in the dealer FCR (from the frozen snapshot) and on the account page.

const php0 = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 }))
// Month grid in thousands so twelve months fit the form width on a laptop.
const k0 = (n) => (n == null ? '' : Math.round(Number(n) / 1000).toLocaleString('en-PH'))
const tone = (a) => (a != null && a >= 1 ? 'text-ok' : '')
const short = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1].charAt(0)}${MONTHS[Number(m.slice(5, 7)) - 1].slice(1).toLowerCase()}`

// "JC NOGUERA Jan–Mar · MERRYGEM PAGA Apr–Dec"
export function ownerSpans(months) {
  const spans = []
  for (const r of months) {
    const k = r.kam || 'No KAM'
    const last = spans.at(-1)
    if (r.target == null && !r.kam) continue
    if (last && last.kam === k && last.to === months[months.indexOf(r) - 1]?.month) last.to = r.month
    else spans.push({ kam: k, from: r.month, to: r.month })
  }
  return spans.map((s) => `${s.kam} ${short(s.from)}${s.from !== s.to ? `–${short(s.to)}` : ''}`).join(' · ')
}

export function PerformanceTable({ snap, highlight }) {
  const scroller = useRef(null)
  const vm = highlight || snap?.visit_month
  // On a phone the grid scrolls sideways: open it at the visit month.
  useEffect(() => {
    const el = scroller.current
    const th = el?.querySelector('[data-current]')
    if (el && th && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, th.offsetLeft - 104 - th.offsetWidth * 2)
  }, [vm, snap])
  if (!snap) return null
  const loaded = (m) => snap.as_of && m <= snap.as_of
  const ytdPct = achievement(snap.ytd_actual, snap.ytd_target)
  const stats = [
    [`Target, ${monthName(vm)}`, php0(snap.month_target) || '—'],
    [`Target, ${snap.quarter} ${snap.year}`, php0(snap.quarter_target)],
    [`FY ${snap.year} TTA target`, php0(snap.fy_target)],
    snap.as_of
      ? [`Actual, Jan–${short(snap.as_of)}`, `${php0(snap.ytd_actual)}`, `${pct(ytdPct)} of ${php0(snap.ytd_target)} target`]
      : ['Actual sales', 'No final DSR loaded yet'],
  ]
  return (
    <div className="bg-white">
      <dl className="grid grid-cols-2 lg:grid-cols-4 border-b border-ink/70">
        {stats.map(([k, v, sub]) => (
          <div key={k} className="px-3 py-2 border-line odd:border-r lg:border-r lg:last:border-r-0">
            <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-ink-3">{k}</dt>
            <dd className="text-[15px] font-semibold tabular-nums mt-0.5">{v}</dd>
            {sub && <dd className={`text-[12px] tabular-nums ${ytdPct != null && ytdPct < 1 ? 'text-warn' : 'text-ok'}`}>{sub}</dd>}
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto" ref={scroller}>
        <table className="w-full border-collapse text-[12px] min-w-[640px]">
          <thead>
            <tr className="border-b border-ink/70">
              <th className="sticky left-0 z-[1] bg-white w-[96px] px-2 h-8 text-left text-[12px] font-semibold whitespace-nowrap">PHP '000</th>
              {snap.months.map((r) => (
                <th key={r.month} data-current={r.month === vm ? '' : undefined} className={`px-1.5 h-8 text-right text-[12px] font-semibold ${r.month === vm ? 'bg-accent-soft text-accent' : ''}`}>{short(r.month)}</th>
              ))}
              <th className="px-2 h-8 text-right text-[12px] font-semibold bg-canvas whitespace-nowrap">{snap.as_of ? `YTD ${short(snap.as_of)}` : 'FY'}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="sticky left-0 bg-white px-2 py-1.5 italic text-ink-2">Target</td>
              {snap.months.map((r) => <td key={r.month} className={`px-1.5 py-1.5 text-right tabular-nums ${r.month === vm ? 'bg-accent-soft font-semibold' : ''}`}>{k0(r.target)}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold bg-canvas">{k0(snap.as_of ? snap.ytd_target : snap.fy_target)}</td>
            </tr>
            <tr className="border-b border-line">
              <td className="sticky left-0 bg-white px-2 py-1.5 italic text-ink-2 whitespace-nowrap">Actual sales</td>
              {snap.months.map((r) => <td key={r.month} className={`px-1.5 py-1.5 text-right tabular-nums ${r.month === vm ? 'bg-accent-soft' : ''}`}>{loaded(r.month) ? k0(r.actual ?? 0) : <span className="text-ink-4">–</span>}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold bg-canvas">{snap.as_of ? k0(snap.ytd_actual) : ''}</td>
            </tr>
            <tr>
              <td className="sticky left-0 bg-white px-2 py-1.5 italic text-ink-2">Achievement</td>
              {snap.months.map((r) => {
                const a = loaded(r.month) ? achievement(r.actual ?? 0, r.target) : null
                return <td key={r.month} className={`px-1.5 py-1.5 text-right tabular-nums ${tone(a)} ${r.month === vm ? 'bg-accent-soft' : ''}`}>{pct(a)}</td>
              })}
              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold bg-canvas ${tone(ytdPct)}`}>{pct(ytdPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-3 py-1.5 text-2xs text-ink-3 border-t border-line">
        BP {snap.bp_code} · Held by {ownerSpans(snap.months)} · Target from the TTA plan; actual sales from the final DSR{snap.as_of ? ` (loaded through ${monthName(snap.as_of)})` : ''}. YTD compares actual with target for the months loaded.
      </p>
    </div>
  )
}
