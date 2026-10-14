// Visit photo: one per FCR, required before the acknowledgement request.
//
// Rules (Ronald, Oct 14, 2026):
//  * Taken ONLY with the in-app live camera on a phone: no gallery, no file
//    upload. A laptop hands off to the phone with a QR code.
//  * Location is required (the database refuses a photo without it).
//  * Recorded with each photo:
//      uploaded_at   database time when attached (the KAM cannot set it)
//      taken_at      moment the shutter was pressed (device clock)
//      lat/lng/acc   the phone's location at capture, with accuracy
//      place_label   readable address for the coordinates (OpenStreetMap)
//      device        e.g. "iPhone · Safari", "Android · Chrome"
//    and the time + place are stamped onto the image itself.
//  * No location-based flags: KAMs meet customers at restaurants and other
//    venues. Only venue-independent flags (photoFlags below).
import { supabase, rpc } from './supabase'
import { fmtDateTime } from './dates'

export const PHOTO_BUCKET = 'fcr-photos'
export const PHOTO_RETENTION_DAYS = 60
const MAX_SIDE = 1280
const QUALITY = 0.75

// Manila calendar date of a timestamp (PH has no daylight saving).
export const manilaYmd = (ts) => (ts ? new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10) : null)
export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`

// Phone or tablet (has a camera + GPS in the hand). iPadOS reports itself as
// a Mac, so it is detected by touch support.
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  return Boolean(navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS)
}

export function deviceLabel() {
  const ua = navigator.userAgent || ''
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : 'Other'
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${os} · ${br}`
}

export const cameraSupported = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia)

// Location for the photo. Resolves { loc } or { error } (never throws), so the
// camera screen can explain what to fix.
export function getLocation(timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'unsupported' })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ loc: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) } }),
      (e) => resolve({ error: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

// Readable address for the RSM. Best effort; coordinates are the record.
export async function placeName(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } })
    if (!r.ok) return null
    const j = await r.json()
    return j?.display_name ? j.display_name.split(', ').slice(0, 5).join(', ') : null
  } catch { return null }
}

// Grab the current camera frame, shrink to ~150 KB and stamp time + place.
export async function captureFrame(video, { loc, place, who }) {
  const vw = video.videoWidth; const vh = video.videoHeight
  if (!vw || !vh) throw new Error('The camera is not ready yet')
  const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh))
  const w = Math.round(vw * scale); const h = Math.round(vh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const g = canvas.getContext('2d')
  g.drawImage(video, 0, 0, w, h)
  const takenAt = new Date()
  const lines = [
    `${fmtDateTime(takenAt.toISOString())}${who ? ` · ${who}` : ''}`,
    loc ? `${place ? `${place} · ` : ''}${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} ±${loc.accuracy} m` : '',
  ].filter(Boolean)
  const fs = Math.max(14, Math.round(w / 48))
  g.font = `600 ${fs}px Inter, -apple-system, Segoe UI, sans-serif`
  const pad = Math.round(fs * 0.6)
  const boxH = lines.length * (fs + 6) + pad * 2
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, h - boxH, w, boxH)
  g.fillStyle = '#fff'
  lines.forEach((t, i) => g.fillText(t.length > 110 ? `${t.slice(0, 107)}…` : t, pad, h - boxH + pad + fs + i * (fs + 6) - 2))
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', QUALITY))
  return { blob, width: w, height: h, takenAt: takenAt.toISOString() }
}

// Upload + attach a photo captured in the app.
export async function uploadCapturedPhoto({ fcrId, ownerId, shot, loc, place }) {
  const path = `${ownerId}/${fcrId}/${crypto.randomUUID()}.jpg`
  const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, shot.blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(upErr.message)
  let oldPath = null
  try {
    oldPath = await rpc('attach_fcr_photo', {
      p_fcr: fcrId, p_path: path, p_taken_at: shot.takenAt, p_exif_lat: null, p_exif_lng: null,
      p_lat: loc.lat, p_lng: loc.lng, p_accuracy: loc.accuracy,
      p_place: place, p_width: shot.width, p_height: shot.height, p_bytes: shot.blob.size,
      p_device: deviceLabel(), p_source: 'live_camera',
    })
  } catch (e) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    throw e
  }
  if (oldPath) await supabase.storage.from(PHOTO_BUCKET).remove([oldPath])
}

export async function photoUrl(path, seconds = 3600) {
  if (!path) return null
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds)
  return data?.signedUrl || null
}

// Venue-independent flags only.
export function photoFlags(photo, visitDate) {
  if (!photo) return []
  const flags = []
  const shotDate = manilaYmd(photo.taken_at || photo.uploaded_at)
  if (visitDate && shotDate && shotDate !== visitDate) flags.push(`Photo ${photo.taken_at ? 'taken' : 'uploaded'} on a different day than the visit`)
  if (photo.lat == null) flags.push('Location not shared')
  if (photo.source && photo.source !== 'live_camera') flags.push('Not taken with the in-app camera')
  return flags
}

// Plain-text lines for the PDF / Excel / review screens.
export function photoFacts(photo) {
  if (!photo) return []
  const out = []
  if (photo.taken_at) out.push(`Photo time: ${fmtDateTime(photo.taken_at)}`)
  out.push(`Uploaded: ${fmtDateTime(photo.uploaded_at)}`)
  if (photo.lat != null) out.push(`Location: ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}${photo.accuracy_m ? ` (±${Math.round(photo.accuracy_m)} m)` : ''}`)
  if (photo.place_label) out.push(`Place: ${photo.place_label}`)
  if (photo.device) out.push(`Device: ${photo.device}${photo.source === 'live_camera' ? ' (in-app camera)' : ''}`)
  if (photo.exif_lat != null) out.push(`Photo GPS: ${photo.exif_lat.toFixed(5)}, ${photo.exif_lng.toFixed(5)}`)
  if (photo.purged_at) out.push(`Photo file deleted ${fmtDateTime(photo.purged_at)} (${PHOTO_RETENTION_DAYS}-day retention); details kept`)
  return out
}
