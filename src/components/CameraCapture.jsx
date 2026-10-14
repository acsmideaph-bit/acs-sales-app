import { useEffect, useRef, useState } from 'react'
import { X, RefreshCw, MapPin, Check, SwitchCamera, AlertTriangle, Loader2 } from 'lucide-react'
import { captureFrame, getLocation, placeName } from '../lib/photo'

const LOCATION_HELP = {
  denied: 'Location is blocked for this site. Allow it, then tap Try again. iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Android: tap the lock icon next to the address → Permissions → Location → Allow.',
  timeout: 'Your phone could not get a location fix in time. Move near a window or outdoors, check that Location is on, then tap Try again.',
  unavailable: 'Your phone could not get a location. Check that Location is on, then tap Try again.',
  unsupported: 'This browser cannot share location. Open the app in Chrome (Android) or Safari (iPhone).',
}

// Full-screen live camera. Location is read first and is required; the
// shutter stays disabled until there is a fix. No gallery, no file upload.
export function CameraCapture({ who, onCancel, onUse }) {
  const video = useRef(null)
  const stream = useRef(null)
  const [facing, setFacing] = useState('environment')
  const [camError, setCamError] = useState('')
  const [loc, setLoc] = useState(null)
  const [locError, setLocError] = useState('')
  const [place, setPlace] = useState(null)
  const [shot, setShot] = useState(null) // { blob, width, height, takenAt, url }
  const [busy, setBusy] = useState(false)

  const readLocation = async () => {
    setLocError(''); setLoc(null)
    const r = await getLocation()
    if (r.loc) { setLoc(r.loc); placeName(r.loc.lat, r.loc.lng).then(setPlace) } else setLocError(r.error)
  }
  useEffect(() => { readLocation() }, [])

  useEffect(() => {
    let cancelled = false
    setCamError('')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream.current = s
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) }
      })
      .catch((e) => setCamError(e?.name === 'NotAllowedError'
        ? 'Camera access is blocked for this site. Allow the camera in your browser settings, then reopen.'
        : 'The camera could not start. Close other apps using the camera and try again.'))
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }
  }, [facing])

  useEffect(() => () => { if (shot?.url) URL.revokeObjectURL(shot.url) }, [shot])

  const snap = async () => {
    try {
      const s = await captureFrame(video.current, { loc, place, who })
      setShot({ ...s, url: URL.createObjectURL(s.blob) })
    } catch (e) { setCamError(e.message) }
  }
  const use = async () => {
    setBusy(true)
    try { await onUse({ shot, loc, place }) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col text-white" role="dialog" aria-label="Take visit photo">
      <div className="flex items-center justify-between px-4 h-12 shrink-0">
        <button onClick={onCancel} className="p-2 -ml-2" aria-label="Close"><X size={20} /></button>
        <span className="text-[14px] font-semibold">Visit photo</span>
        <button onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} className="p-2 -mr-2" aria-label="Switch camera" disabled={Boolean(shot)}><SwitchCamera size={20} /></button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
        {/* The video stays mounted (hidden) during review so Retake resumes instantly. */}
        <video ref={video} playsInline muted autoPlay className={`max-h-full max-w-full object-contain ${facing === 'user' ? '-scale-x-100' : ''} ${shot ? 'hidden' : ''}`} />
        {shot && <img src={shot.url} alt="Captured" className="max-h-full max-w-full object-contain" />}
        {camError && <p className="absolute inset-x-4 top-4 rounded bg-bad/90 px-3 py-2 text-[13px]">{camError}</p>}
      </div>

      <div className="shrink-0 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] space-y-3 bg-black">
        <div className="text-[12px] min-h-[36px]">
          {loc ? (
            <p className="flex items-start gap-1.5 text-white/85"><MapPin size={14} className="mt-0.5 shrink-0 text-ok" />
              <span>{place || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`} <span className="text-white/50">±{loc.accuracy} m</span></span></p>
          ) : locError ? (
            <div className="flex items-start gap-1.5 text-warn-soft"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{LOCATION_HELP[locError]} <button className="underline ml-1" onClick={readLocation}>Try again</button></span></div>
          ) : <p className="flex items-center gap-1.5 text-white/70"><Loader2 size={14} className="animate-spin" /> Getting your location… (required)</p>}
        </div>

        {shot ? (
          <div className="grid grid-cols-2 gap-3">
            <button className="h-12 rounded-lg bg-white/10 font-semibold inline-flex items-center justify-center gap-2" onClick={() => setShot(null)} disabled={busy}><RefreshCw size={16} /> Retake</button>
            <button className="h-12 rounded-lg bg-accent font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60" onClick={use} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busy ? 'Saving…' : 'Use photo'}</button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button onClick={snap} disabled={!loc || Boolean(camError)} aria-label="Take photo"
              className="w-16 h-16 rounded-full border-4 border-white/80 bg-white disabled:opacity-30 active:scale-95 transition-transform" />
          </div>
        )}
        <p className="text-center text-[11px] text-white/50">Ask the customer first. Time and location are stamped on the photo.</p>
      </div>
    </div>
  )
}
