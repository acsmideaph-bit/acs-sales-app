import { Fragment } from 'react'
import { Plus, X } from 'lucide-react'
import {
  HEADER_FIELDS, columnTotal, peso, matrixCell, matrixColumnLabels,
} from '../../lib/fcrTemplates'
import { fmt } from '../../lib/dates'
import { PerformanceTable } from '../../components/Performance'

// Renders any FCR template (see lib/fcrTemplates.js). Layout follows the
// paper form: black section bars, bordered tables, same row/column labels.

function SectionBar({ title, right }) {
  return (
    <div className="section-bar flex items-center justify-between">
      <span>{title}</span>{right}
    </div>
  )
}

function CellInput({ col, value, onChange, readOnly, listId }) {
  if (readOnly) {
    const v = col.type === 'number' ? peso(value) : col.type === 'date' ? fmt(value) : value
    return <div className={`px-2 py-1.5 min-h-[32px] text-[13px] whitespace-pre-wrap ${col.type === 'number' ? 'text-right tabular-nums' : ''}`}>{v}</div>
  }
  return (
    <input
      className={`cell-input ${col.type === 'number' ? 'text-right tabular-nums' : ''}`}
      type={col.type === 'date' ? 'date' : 'text'}
      inputMode={col.type === 'number' ? 'decimal' : undefined}
      list={listId}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label={col.label}
    />
  )
}

function GridSection({ s, value, onChange, readOnly }) {
  const cols = s.columns
  const setRow = (i, k, v) => onChange({ ...value, rows: value.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  const setField = (k, v) => onChange({ ...value, f: { ...value.f, [k]: v } })
  const addRow = () => onChange({ ...value, rows: [...value.rows, Object.fromEntries(cols.map((c) => [c.key, '']))] })
  const delRow = (i) => onChange({ ...value, rows: value.rows.filter((_, j) => j !== i) })
  const canAdd = !readOnly && s.addable && value.rows.length < (s.maxRows || 20)
  const minRows = s.rows || 0

  return (
    <section className="border border-ink rounded overflow-hidden">
      <SectionBar title={s.title} />
      {s.fields?.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 px-3 py-2.5 border-b border-ink/70 bg-white">
          {s.fields.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-[13px]">
              <span className="font-semibold whitespace-nowrap">{f.label}:</span>
              {readOnly ? <span className={f.type === 'number' ? 'tabular-nums' : ''}>{f.type === 'number' ? peso(value.f?.[f.key]) : value.f?.[f.key]}</span>
                : <input className="input h-7" inputMode={f.type === 'number' ? 'decimal' : undefined} value={value.f?.[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />}
            </label>
          ))}
        </div>
      )}
      <div className="overflow-x-auto bg-white">
        <table className="w-full border-collapse text-[13px] min-w-[640px]">
          <thead>
            <tr>
              {s.rowKey && <th className="border-b border-r border-ink/70 px-2 h-8 text-[12px] font-semibold w-[22%]">{s.rowLabel}</th>}
              {cols.map((c) => <th key={c.key} style={{ width: c.width }} className={`border-b border-r last:border-r-0 border-ink/70 px-2 h-8 text-[12px] font-semibold ${c.type === 'number' ? 'text-right' : 'text-center'}`}>{c.label}</th>)}
              {!readOnly && s.addable && <th className="border-b border-ink/70 w-8" />}
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                {s.rowKey && (
                  <td className="border-r border-ink/70 px-2 py-1 text-[13px] font-medium">
                    {s.editableRowLabels?.includes(s.fixedRows?.[i]) && !readOnly
                      ? <input className="cell-input font-medium" value={r[s.rowKey]} onChange={(e) => setRow(i, s.rowKey, e.target.value)} aria-label="Row label" />
                      : r[s.rowKey]}
                  </td>
                )}
                {cols.map((c) => (
                  <td key={c.key} className="border-r last:border-r-0 border-line p-0 align-top">
                    <CellInput col={c} value={r[c.key]} readOnly={readOnly} listId={c.suggest ? `dl-${s.key}-${c.key}` : undefined} onChange={(v) => setRow(i, c.key, v)} />
                  </td>
                ))}
                {!readOnly && s.addable && (
                  <td className="text-center">
                    {i >= minRows && <button className="btn-ghost h-6 w-6 px-0 text-ink-4" onClick={() => delRow(i)} aria-label="Remove row"><X size={13} /></button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {s.totals?.length > 0 && (
            <tfoot>
              <tr className="border-t border-ink/70 bg-canvas font-semibold">
                {s.rowKey && <td className="px-2 py-1.5 border-r border-ink/70">Total</td>}
                {cols.map((c, i) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                    {s.totals.includes(c.key) ? peso(columnTotal(value, c.key)) : (!s.rowKey && i === 0 ? 'Total' : '')}
                  </td>
                ))}
                {!readOnly && s.addable && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {cols.filter((c) => c.suggest).map((c) => (
        <datalist key={c.key} id={`dl-${s.key}-${c.key}`}>{c.suggest.map((o) => <option key={o} value={o} />)}</datalist>
      ))}
      {canAdd && (
        <div className="px-2 py-1.5 border-t border-line bg-white">
          <button className="btn-ghost h-7 text-[12px] text-accent" onClick={addRow}><Plus size={13} /> Add row</button>
        </div>
      )}
    </section>
  )
}

function MatrixSection({ s, value, onChange, readOnly }) {
  const labels = matrixColumnLabels(s, value.period)
  const setCell = (g, m, c, v) => onChange({
    ...value, v: { ...value.v, [g]: { ...(value.v?.[g] || {}), [m]: { ...(value.v?.[g]?.[m] || {}), [c]: v } } },
  })
  return (
    <section className="border border-ink rounded overflow-hidden">
      <SectionBar title={s.title} right={
        <span className="flex items-center gap-1.5 not-italic font-medium">
          {s.periodLabel}:
          {readOnly ? <span>{value.period}</span> : (
            <select className="h-6 rounded bg-white text-ink text-[12px] px-1" value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}>
              {s.periods.map((p) => <option key={p}>{p}</option>)}
            </select>
          )}
        </span>} />
      <div className="overflow-x-auto bg-white">
        <table className="w-full border-collapse text-[13px] min-w-[720px]">
          <thead>
            <tr className="border-b border-ink/70">
              <th className="w-[19%]" />
              {s.columns.map((c, i) => <th key={c.key} className={`px-2 h-8 text-[12px] font-semibold text-right ${c.computed ? 'bg-canvas' : ''}`}>{labels[i]}</th>)}
            </tr>
          </thead>
          <tbody>
            {s.groups.map((g) => (
              <Fragment key={g}>
                <tr><td colSpan={s.columns.length + 1} className="px-2 pt-2.5 pb-1 font-semibold text-[13px]">{g}</td></tr>
                {s.metrics.map((m) => (
                  <tr key={`${g}-${m.key}`} className="border-b border-line">
                    <td className="px-2 py-1 text-right italic text-ink-2 text-[12.5px] whitespace-nowrap">{m.label}</td>
                    {s.columns.map((c) => {
                      const computed = m.computed || c.computed
                      const v = matrixCell(s, value, g, m.key, c.key)
                      return (
                        <td key={c.key} className={`border-l border-line p-0 ${computed ? 'bg-canvas' : ''}`}>
                          {computed || readOnly
                            ? <div className={`px-2 py-1.5 text-right tabular-nums ${m.computed && v < 0 ? 'text-ok' : ''} ${computed ? 'font-medium' : ''}`}>{v == null ? '' : peso(v)}</div>
                            : <input className="cell-input text-right tabular-nums" inputMode="decimal" aria-label={`${g} ${m.label} ${c.label}`}
                                value={value.v?.[g]?.[m.key]?.[c.key] ?? ''} onChange={(e) => setCell(g, m.key, c.key, e.target.value)} />}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <p className="px-3 py-1.5 text-2xs text-ink-4 bg-white border-t border-line">Shaded cells are calculated. Enter amounts in PHP (or units, consistently).</p>}
    </section>
  )
}

// Filled by the app from the TTA plan and final DSR (by BP code); never typed.
function PerformanceSection({ s, value, loading }) {
  return (
    <section className="border border-ink rounded overflow-hidden">
      <SectionBar title={s.title} right={value?.bp_code ? <span className="hidden sm:inline not-italic font-medium">BP {value.bp_code}</span> : null} />
      {value ? <PerformanceTable snap={value} /> : (
        <p className="px-3 py-3 bg-white text-[13px] text-ink-3">{loading ? 'Loading the account target and sales…' : 'No TTA target found for this account and year.'}</p>
      )}
    </section>
  )
}

function TextSection({ s, value, onChange, readOnly, error }) {
  return (
    <section className={`border rounded overflow-hidden ${error ? 'border-bad' : 'border-ink'}`}>
      <SectionBar title={s.title} />
      {readOnly
        ? <div className="px-3 py-2.5 min-h-[64px] bg-white text-[13px] whitespace-pre-wrap leading-relaxed">{value || <span className="text-ink-4">None</span>}</div>
        : <textarea className="block w-full px-3 py-2.5 bg-white text-[13px] leading-relaxed focus:outline-none focus:bg-accent-soft/40" rows={s.rowsHint || 4}
            placeholder={s.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />}
      {error && <p className="px-3 py-1 text-[12px] text-bad bg-white">{error}</p>}
    </section>
  )
}

export function CustomerInfo({ template, info, visitDate, period, kamName }) {
  const fields = HEADER_FIELDS(template)
  return (
    <section className="border border-ink rounded overflow-hidden">
      <SectionBar title="Customer Information" />
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 px-3 py-3 bg-white text-[13px]">
        {fields.map(([k, label]) => (
          <div key={k} className="flex gap-2 min-w-0">
            <span className="w-[130px] flex-shrink-0 text-right font-medium text-ink-2">{label}:</span>
            <span className="border-b border-ink/40 flex-1 min-w-0 truncate">{info?.[k]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-3 py-2 border-t border-ink/70 bg-white text-[13px] font-semibold">
        <span>ASE / TSE: <span className="font-normal">{kamName || info?.ase_tse}</span></span>
        <span>Visit Freq / Days: <span className="font-normal">{info?.visit_freq_days}</span></span>
        <span>Visit Date: <span className="font-normal tabular-nums">{fmt(visitDate, 'MM/dd/yyyy')} {period}</span></span>
      </div>
    </section>
  )
}

export function FCRFormBody({ template, formData, onChange, readOnly, errors = {}, performanceLoading = false }) {
  const set = (key) => (v) => onChange({ ...formData, [key]: v })
  return (
    <div className="space-y-4">
      {template.sections.map((s) => {
        const value = formData[s.key]
        if (s.kind === 'performance') return <PerformanceSection key={s.key} s={s} value={value} loading={performanceLoading} />
        if (s.kind === 'text') return <TextSection key={s.key} s={s} value={value} onChange={set(s.key)} readOnly={readOnly} error={errors[s.key]} />
        if (s.kind === 'matrix') return <MatrixSection key={s.key} s={s} value={value} onChange={set(s.key)} readOnly={readOnly} />
        return <GridSection key={s.key} s={s} value={value} onChange={set(s.key)} readOnly={readOnly} />
      })}
    </div>
  )
}

