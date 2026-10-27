import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, X, RotateCcw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useProfiles } from '../lib/data'
import { fmt, fmtDateTime } from '../lib/dates'
import { fetchGetBacks, setGetBackStatus, daysOverdue, effectiveDue, canActOnGetBack, notifyGetBackChanged } from '../lib/getBack'
import { prompt } from './ui'

export function DueTag({ g }) {
  if (g.status !== 'open') return <span className={g.status === 'done' ? 'chip-approved' : 'chip-draft'}>{g.status === 'done' ? 'Done' : 'Dropped'}</span>
  const late = daysOverdue(g)
  const due = effectiveDue(g)
  if (late > 0) return <span className="chip-rejected whitespace-nowrap">{late}d overdue</span>
  return <span className="chip-draft whitespace-nowrap">{g.due_date ? `Due ${fmt(due, 'MMM d')}` : `~${fmt(due, 'MMM d')}`}</span>
}

// Close / drop / reopen, shared by the panel and the Get-back items page.
export async function changeGetBack(g, status) {
  let note = null
  if (status === 'dropped') {
    note = await prompt({ title: 'Drop this get-back item?', body: `"${g.item}"`, label: 'Why is it no longer needed? (required)', required: true, confirmLabel: 'Drop item', danger: true })
    if (!note) return false
  } else if (status === 'done') {
    note = await prompt({ title: 'Mark as done', body: `"${g.item}"`, label: 'How was it delivered? (optional)', confirmLabel: 'Mark done' })
    if (note === null) return false
  }
  try {
    await setGetBackStatus(g.id, status, note || null)
    toast.success(status === 'open' ? 'Reopened' : status === 'done' ? 'Marked done' : 'Dropped')
    notifyGetBackChanged()
    return true
  } catch (e) { toast.error(e.message); return false }
}

// Open promises for one account, with the last few closed ones on request.
export function GetBackPanel({ accountId, accountKamId, title = 'Open get-back items' }) {
  const { user, canWrite } = useAuth()
  const [items, setItems] = useState(null)
  const [showClosed, setShowClosed] = useState(false)
  const { byId } = useProfiles()

  const load = useCallback(async () => {
    if (!accountId) return
    try { setItems(await fetchGetBacks({ accountId })) } catch { setItems([]) }
  }, [accountId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener('acs:getback-changed', load)
    return () => window.removeEventListener('acs:getback-changed', load)
  }, [load])

  if (!accountId || items === null) return null
  const open = items.filter((g) => g.status === 'open').sort((a, b) => daysOverdue(b) - daysOverdue(a) || String(effectiveDue(a)).localeCompare(String(effectiveDue(b))))
  const closed = items.filter((g) => g.status !== 'open').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at))).slice(0, 8)
  const ctx = { userId: user.id, byId, accountKamId, canWrite }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="text-[12px] text-ink-3 tabular-nums">{open.length} open</span>
      </div>
      {open.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-3">No open promises. Items appear here when an FCR with get-back items is approved.</p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map((g) => (
            <li key={g.id} className="px-4 py-2.5">
              <div className="flex items-start gap-2">
                <p className="text-[13px] leading-snug flex-1 min-w-0 break-words">{g.item}</p>
                <DueTag g={g} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Link to={`/fcr/${g.fcr_id}`} className="text-2xs text-ink-4 hover:text-accent">Promised {fmt(g.promised_on)}{byId[g.owner_id] ? ` by ${byId[g.owner_id].full_name}` : ''}</Link>
                {canActOnGetBack(g, ctx) && (
                  <span className="ml-auto flex gap-1">
                    <button className="btn-ghost h-6 px-1.5 text-[12px] text-ok" onClick={() => changeGetBack(g, 'done')}><Check size={13} /> Done</button>
                    <button className="btn-ghost h-6 px-1.5 text-[12px] text-ink-3" onClick={() => changeGetBack(g, 'dropped')}><X size={13} /> Drop</button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <div className="border-t border-line px-4 py-2">
          <button className="btn-ghost h-6 px-0 text-[12px] text-ink-3" onClick={() => setShowClosed((v) => !v)}>{showClosed ? 'Hide' : 'Show'} recently closed ({closed.length})</button>
          {showClosed && (
            <ul className="mt-1 space-y-2 pb-1">
              {closed.map((g) => (
                <li key={g.id} className="text-[12px] text-ink-3">
                  <div className="flex items-start gap-2"><span className="flex-1 line-through decoration-ink-4">{g.item}</span><DueTag g={g} /></div>
                  <div className="flex items-center gap-2">
                    <span>{byId[g.closed_by]?.full_name || 'Closed'} · {fmtDateTime(g.closed_at)}{g.close_note ? ` · ${g.close_note}` : ''}</span>
                    {canActOnGetBack(g, ctx) && <button className="btn-ghost h-5 px-1 ml-auto text-[11px]" onClick={() => changeGetBack(g, 'open')}><RotateCcw size={11} /> Reopen</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
