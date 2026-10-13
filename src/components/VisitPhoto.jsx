import { useEffect, useRef, useState } from 'react'
import { Camera, MapPin, AlertTriangle, RefreshCw, ImageOff } from 'lucide-react'
import { photoUrl, photoFlags, mapsUrl, PHOTO_RETENTION_DAYS } from '../lib/photo'
import { fmtDateTime } from '../lib/dates'

// Visit photo panel on the FCR. One photo, required before the
// acknowledgement request; locked once the request is out.
export function VisitPhoto({ photo, visitDate, canChange, busyStep, onFile, error }) {
  const input = useRef(null)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (photo?.storage_path && !photo.purged_at) photoUrl(photo.storage_path).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [photo?.storage_path, photo?.purged_at])

  const flags = photoFlags(photo, visitDate)
  const pick = () => input.current?.click()

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title flex items-center gap-1.5"><Camera size={14} /> Visit photo{canChange && !photo ? ' *' : ''}</span>
        {photo && !flags.length && <span className="chip-approved">Recorded</span>}
        {flags.length > 0 && <span className="chip-pending">{flags.length} to check</span>}
      </div>
      <div className="p-4 space-y-3">
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />

        {!photo && (
          canChange ? (
            <>
              <button className={`w-full rounded border border-dashed ${error ? 'border-bad' : 'border-line-strong'} bg-canvas py-6 flex flex-col items-center gap-1.5 text-ink-2 hover:bg-white disabled:opacity-60`}
                onClick={pick} disabled={Boolean(busyStep)}>
                <Camera size={22} />
                <span className="text-[13px] font-medium">{busyStep || 'Take photo with the customer'}</span>
                <span className="text-2xs text-ink-4">Required before sending for acknowledgement</span>
              </button>
              {error && <p className="text-[12px] text-bad">{error}</p>}
              <p className="text-2xs text-ink-4 leading-relaxed">Ask the customer first. Location and time are recorded with the photo. Photos are deleted after {PHOTO_RETENTION_DAYS} days; the details stay on the FCR.</p>
            </>
          ) : <p className="text-[12px] text-ink-3">No photo attached.</p>
        )}

        {photo && (
          <>
            {photo.purged_at ? (
              <div className="rounded bg-canvas py-6 flex flex-col items-center gap-1 text-ink-3 text-[12px]"><ImageOff size={18} /> Photo deleted after {PHOTO_RETENTION_DAYS} days</div>
            ) : url ? (
              <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Visit photo" className="w-full rounded border border-line object-cover max-h-72" /></a>
            ) : <div className="rounded bg-canvas h-40 animate-pulse" />}

            {flags.length > 0 && (
              <ul className="space-y-1">
                {flags.map((f) => <li key={f} className="flex items-start gap-1.5 text-[12px] text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {f}</li>)}
              </ul>
            )}

            <dl className="text-[12px] grid grid-cols-[88px_1fr] gap-x-2 gap-y-1">
              {photo.taken_at && <><dt className="text-ink-3">Photo time</dt><dd>{fmtDateTime(photo.taken_at)}</dd></>}
              <dt className="text-ink-3">Uploaded</dt><dd>{fmtDateTime(photo.uploaded_at)}</dd>
              <dt className="text-ink-3">Location</dt>
              <dd>{photo.lat != null ? (
                <a className="text-accent inline-flex items-start gap-1" href={mapsUrl(photo.lat, photo.lng)} target="_blank" rel="noreferrer">
                  <MapPin size={12} className="mt-0.5 shrink-0" />
                  <span>{photo.place_label || `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`}{photo.accuracy_m ? <span className="text-ink-4"> ±{Math.round(photo.accuracy_m)} m</span> : null}</span>
                </a>
              ) : <span className="text-ink-3">Not shared</span>}</dd>
              {photo.exif_lat != null && <><dt className="text-ink-3">Photo GPS</dt><dd><a className="text-accent" href={mapsUrl(photo.exif_lat, photo.exif_lng)} target="_blank" rel="noreferrer">{photo.exif_lat.toFixed(5)}, {photo.exif_lng.toFixed(5)}</a></dd></>}
            </dl>

            {canChange && <button className="btn-ghost w-full" onClick={pick} disabled={Boolean(busyStep)}><RefreshCw size={14} /> {busyStep || 'Retake photo'}</button>}
            {!canChange && photo && !photo.purged_at && <p className="text-2xs text-ink-4">Locked once the acknowledgement request went out.</p>}
          </>
        )}
      </div>
    </div>
  )
}
