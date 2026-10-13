import { Plus, StickyNote } from 'lucide-react'
import { monthWeeks, WEEKDAYS } from '../lib/mcp'
import { fmt, todayYmd, toDate } from '../lib/dates'

// MCP calendar: Monday-Friday work weeks, AM and PM per day (Saturday column
// appears only when something is scheduled on one). Shared by MCP Plan and
// MCP Actual so both read the same way as the paper MCP.
//
// items: [{ id, visit_date, period, label, sub?, tone?: 'plan'|'done'|'missed' }]
export function MonthCalendar({ month, items = [], notes = {}, onAddDay, onItemClick, onNoteClick, readOnly }) {
  const hasSat = items.some((i) => toDate(i.visit_date).getDay() === 6)
  const weeks = monthWeeks(month, { includeSaturday: hasSat })
  const cols = hasSat ? 6 : 5
  const today = todayYmd()
  const at = (d, p) => items.filter((i) => i.visit_date === d && (i.period === 'PM' ? 'PM' : 'AM') === p)
  const toneCls = (t) => t === 'done' ? 'bg-ok-soft text-ok border-ok/20' : t === 'missed' ? 'bg-bad-soft text-bad border-bad/20' : 'bg-accent-soft text-accent border-accent/15'

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid border-b border-line-strong" style={{ gridTemplateColumns: `44px repeat(${cols}, minmax(0,1fr))` }}>
          <div />
          {WEEKDAYS.slice(0, cols).map((d) => <div key={d} className="px-2 h-8 flex items-center text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3">{d}</div>)}
        </div>
        {weeks.map((w) => (
          <div key={w.n} className="grid border-b border-line" style={{ gridTemplateColumns: `44px repeat(${cols}, minmax(0,1fr))` }}>
            <div className="flex items-start justify-center pt-2 text-2xs font-semibold text-ink-4">W{w.n}</div>
            {w.days.map((d, i) => (
              <div key={i} className={`border-l border-line min-h-[112px] ${d ? '' : 'bg-canvas'}`}>
                {d && (
                  <>
                    <div className="flex items-center justify-between px-2 h-7">
                      <span className={`text-[12px] tabular-nums ${d === today ? 'font-semibold text-accent' : 'text-ink-3'}`}>{fmt(d, 'd')}</span>
                      <div className="flex gap-0.5">
                        {onNoteClick && (
                          <button title={notes[d] ? `Note: ${notes[d]}` : 'Add a day note'} onClick={() => onNoteClick(d)}
                            className={`h-6 w-6 rounded flex items-center justify-center hover:bg-black/[0.06] ${notes[d] ? 'text-warn' : 'text-ink-4'}`}><StickyNote size={13} /></button>
                        )}
                        {!readOnly && onAddDay && (
                          <button title="Add visit" onClick={() => onAddDay(d)} className="h-6 w-6 rounded flex items-center justify-center text-ink-4 hover:bg-black/[0.06] hover:text-accent"><Plus size={14} /></button>
                        )}
                      </div>
                    </div>
                    {['AM', 'PM'].map((p) => (
                      <div key={p} className="flex gap-1 px-1.5 pb-1.5">
                        <span className="w-5 flex-shrink-0 text-[10px] font-semibold text-ink-4 pt-1">{p}</span>
                        <div className="flex-1 min-w-0 space-y-1">
                          {at(d, p).map((it) => (
                            <button key={it.id} onClick={() => onItemClick?.(it)} title={[it.label, it.sub].filter(Boolean).join(' · ')}
                              className={`block w-full text-left px-1.5 py-0.5 rounded-[4px] border text-[11.5px] leading-tight truncate ${toneCls(it.tone)} ${onItemClick ? 'hover:brightness-95' : 'cursor-default'}`}>
                              {it.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {notes[d] && <p className="px-2 pb-1.5 text-[11px] text-warn leading-tight line-clamp-2">{notes[d]}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
