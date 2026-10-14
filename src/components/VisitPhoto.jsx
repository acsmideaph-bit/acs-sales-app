import { useEffect, useState } from 'react'
import { Camera, MapPin, AlertTriangle, RefreshCw, ImageOff, Smartphone, Loader2 } from 'lucide-react'
import { photoUrl, photoFlags, mapsUrl, PHOTO_RETENTION_DAYS, isMobileDevice, cameraSupported } from '../lib/photo'
import { fmtDateTime } from '../lib/dates'
import { CameraCapture } from './CameraCapture'

// The phone link for this FCR's photo step (opened by scanning the QR code).
export const photoStepUrl = (fcrId) => `${window.location.origin}${window.location.pathname}#/fcr/${fcrId}?photo=1`

function PhoneQr({ fcrId }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    import('qrcode').then((q) => q.toDataURL(photoStepUrl(fcrId), { margin: 1, width: 240, errorCorrectionLevel: 'M' })).then((u) => alive && setSrc(u))
    return () => { alive = false }
  }, [fcrId])
  return (
    <div className="rounded border border-line bg-white p-3 flex flex-col items-center gap-2">
      {src ? <img src={src} alt="QR code to open this FCR on your phone" className="w-48 h-48" /> : <div className="w-48 h-48 bg-canvas animate-pulse rounded" />}
      <p className="text-[12px] text-ink-2 text-center leading-snug">Scan with your phone camera. This FCR opens at the photo step.</p>
      <p className="text-2xs text-ink-4 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Waiting for the photo; this page updates by itself.</p>
    </div>
  )
}

// Visit photo panel on the FCR. One photo, required before the
// acknowledgement request; locked once the request is out. Phones use the
// in-app live camera; laptops/desktops hand off to the phone by QR code.
export function VisitPhoto({ photo, visitDate, canChange, error, who, fcrId, onEnsureSaved, onCaptured, onQrChange, highlight }) {
  const mobile = isMobileDevice()
  const [url, setUrl] = useState(null)
  const [camera, setCamera] = useState(false)
  const [qr, setQr] = useState(false)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    let alive = true
    setUrl(null)
    if (photo?.storage_path && !photo.purged_at) photoUrl(photo.storage_path).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [photo?.storage_path, photo?.purged_at])

  // A new photo arrived (e.g. from the phone): close the QR.
  useEffect(() => { if (qr) { setQr(false); onQrChange?.(false) } }, [photo?.storage_path]) // eslint-disable-line react-hooks/exhaustive-deps

  const flags = photoFlags(photo, visitDate)

  const start = async () => {
    if (mobile) {
      if (!cameraSupported()) { alert('This browser cannot open the camera. Open the app in Chrome (Android) or Safari (iPhone).'); return }
      setCamera(true)
      return
    }
    setPreparing(true)
    try {
      const id = fcrId || await onEnsureSaved()
      if (!id) return
      setQr(true); onQrChange?.(true)
    } finally { setPreparing(false) }
  }

  const takeLabel = mobile ? (photo ? 'Retake photo' : 'Take photo with the customer') : (photo ? 'Retake on my phone' : 'Take the photo on my phone')

  return (
    <div id="visit-photo" className={`panel ${highlight ? 'ring-2 ring-accent/40' : ''}`}>
      <div className="panel-head">
        <span className="panel-title flex items-center gap-1.5"><Camera size={14} /> Visit photo{canChange && !photo ? ' *' : ''}</span>
        {photo && !flags.length && <span className="chip-approved">Recorded</span>}
        {flags.length > 0 && <span className="chip-pending">{flags.length} to check</span>}
      </div>
      <div className="p-4 space-y-3">
        {!photo && !canChange && <p className="text-[12px] text-ink-3">No photo attached.</p>}

        {!photo && canChange && !qr && (
          <>
            <button className={`w-full rounded border border-dashed ${error ? 'border-bad' : 'border-line-strong'} bg-canvas py-6 flex flex-col items-center gap-1.5 text-ink-2 hover:bg-white disabled:opacity-60`}
              onClick={start} disabled={preparing}>
              {mobile ? <Camera size={22} /> : <Smartphone size={22} />}
              <span className="text-[13px] font-medium">{preparing ? 'Saving draft…' : takeLabel}</span>
              <span className="text-2xs text-ink-4">{mobile ? 'Live camera · location required' : 'Photos are taken on a phone during the visit'}</span>
            </button>
            {error && <p className="text-[12px] text-bad">{error}</p>}
            <p className="text-2xs text-ink-4 leading-relaxed">Ask the customer first. Time and location are recorded and stamped on the photo. Photos are deleted after {PHOTO_RETENTION_DAYS} days; the details stay on the FCR.</p>
          </>
        )}

        {qr && fcrId && (
          <>
            <PhoneQr fcrId={fcrId} />
            <button className="btn-ghost w-full" onClick={() => { setQr(false); onQrChange?.(false) }}>Cancel</button>
          </>
        )}

        {photo && (
          <>
            {photo.purged_at ? (
              <div className="rounded bg-canvas py-6 flex flex-col items-center gap-1 text-ink-3 text-[12px]"><ImageOff size={18} /> Photo deleted after {PHOTO_RETENTION_DAYS} days</div>
            ) : url ? (
              <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Visit photo" className="w-full rounded border border-line object-contain max-h-80 bg-canvas" /></a>
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
              {photo.device && <><dt className="text-ink-3">Device</dt><dd>{photo.device}{photo.source === 'live_camera' ? <span className="text-ink-4"> · in-app camera</span> : null}</dd></>}
              {photo.exif_lat != null && <><dt className="text-ink-3">Photo GPS</dt><dd><a className="text-accent" href={mapsUrl(photo.exif_lat, photo.exif_lng)} target="_blank" rel="noreferrer">{photo.exif_lat.toFixed(5)}, {photo.exif_lng.toFixed(5)}</a></dd></>}
            </dl>

            {canChange && !qr && <button className="btn-ghost w-full" onClick={start}>{mobile ? <RefreshCw size={14} /> : <Smartphone size={14} />} {takeLabel}</button>}
            {!canChange && !photo.purged_at && <p className="text-2xs text-ink-4">Locked once the acknowledgement request went out.</p>}
          </>
        )}
      </div>

      {camera && (
        <CameraCapture who={who} onCancel={() => setCamera(false)}
          onUse={async (c) => { const ok = await onCaptured(c); if (ok !== false) setCamera(false) }} />
      )}
    </div>
  )
}
