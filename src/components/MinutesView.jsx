// Renders the output of buildMinutes() -- the same object the PDF uses.
export function MinutesView({ minutes }) {
  return (
    <div className="text-[13px] leading-relaxed">
      <dl className="grid grid-cols-[130px_1fr] gap-y-1 pb-3 border-b border-line">
        {minutes.meta.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-ink-3">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
        ))}
      </dl>
      <div className="space-y-3 pt-3">
        {minutes.blocks.map((b) => (
          <div key={b.title}>
            <p className="text-2xs font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">{b.title}</p>
            <ul className="space-y-0.5">
              {b.lines.map((l, i) => <li key={i} className="pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[9px] before:w-1 before:h-1 before:rounded-full before:bg-ink-4">{l}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
