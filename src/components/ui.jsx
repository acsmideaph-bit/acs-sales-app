import { useEffect, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { STATUS_LABELS, ACK_LABELS } from '../lib/roles'

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        {back}
        <h1 className="truncate">{title}</h1>
        {subtitle && <p className="text-[13px] text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatusChip({ status }) {
  const cls = { draft: 'chip-draft', pending_approval: 'chip-pending', approved: 'chip-approved', rejected: 'chip-rejected' }[status] || 'chip-draft'
  return <span className={cls}>{STATUS_LABELS[status] || status}</span>
}

export function AckChip({ status }) {
  const cls = { not_sent: 'chip-draft', pending: 'chip-pending', acknowledged: 'chip-approved' }[status] || 'chip-draft'
  return <span className={cls}>{ACK_LABELS[status] || status}</span>
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-3 text-[13px]">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="py-14 px-6 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <p className="text-[13px] text-ink-3 mt-1 max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  const [show, setShow] = useState(open)
  useEffect(() => {
    if (open) setShow(true)
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open && !show) return null
  return (
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 transition-opacity duration-150 ${open ? 'opacity-100' : 'opacity-0'}`}
      onTransitionEnd={() => !open && setShow(false)}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`relative w-full ${width} bg-white rounded-t-lg sm:rounded-lg shadow-pop max-h-[92vh] flex flex-col transition-transform duration-200 ease-out-strong ${open ? 'translate-y-0 sm:scale-100' : 'translate-y-4 sm:scale-[0.98]'}`}>
        <div className="flex items-center justify-between px-5 h-12 border-b border-line flex-shrink-0">
          <h2>{title}</h2>
          <button className="btn-ghost h-7 w-7 px-0" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

// Promise-based confirm/prompt so callers read top-to-bottom:
//   const ok = await confirm({ title, body })
//   const reason = await prompt({ title, label, required: true })
let setDialogState = null
export function DialogHost() {
  const [state, setState] = useState(null)
  const [text, setText] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { setDialogState = (s) => { setText(s?.initial || ''); setState(s) }; return () => { setDialogState = null } }, [])
  useEffect(() => { if (state?.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 50) }, [state])
  const close = (value) => { state?.resolve(value); setState(null) }
  return (
    <Modal open={Boolean(state)} onClose={() => close(state?.kind === 'prompt' ? null : false)} title={state?.title || ''}
      footer={<>
        <button className="btn-secondary" onClick={() => close(state?.kind === 'prompt' ? null : false)}>Cancel</button>
        <button className={state?.danger ? 'btn-danger' : 'btn-primary'}
          disabled={state?.kind === 'prompt' && state?.required && !text.trim()}
          onClick={() => close(state?.kind === 'prompt' ? text.trim() : true)}>{state?.confirmLabel || 'Confirm'}</button>
      </>}>
      {state?.body && <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{state.body}</p>}
      {state?.kind === 'prompt' && (
        <div className="mt-3">
          {state.label && <label className="label">{state.label}</label>}
          <textarea ref={inputRef} className="input min-h-[96px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={state.placeholder} />
        </div>
      )}
    </Modal>
  )
}
export const confirm = (opts) => new Promise((resolve) => setDialogState?.({ ...opts, kind: 'confirm', resolve }))
export const prompt = (opts) => new Promise((resolve) => setDialogState?.({ ...opts, kind: 'prompt', resolve }))

export function Field({ label, error, children, hint, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-ink-4">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value}
          className={`tab ${value === o.value ? 'tab-active' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, tone }) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink'
  return (
    <div className="panel px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3">{label}</p>
      <p className={`kpi mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[12px] text-ink-3 mt-0.5">{sub}</p>}
    </div>
  )
}
