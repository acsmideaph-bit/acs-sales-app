// Visit photo: one per FCR, required before the acknowledgement request.
//
// Evidence recorded with each photo (see migration 20261014000003):
//   uploaded_at   database time when attached (the KAM cannot set it)
//   lat/lng/acc   the phone's location, read by the app at capture
//   taken_at      the photo's own date/time (EXIF), when the phone keeps it
//   exif_lat/lng  the photo's own GPS, when the phone keeps it (often stripped)
//   place_label   readable address for the coordinates (OpenStreetMap)
// No location-based flags: KAMs meet customers at restaurants and other
// venues. Only venue-independent flags (photoFlags below).
import { supabase, rpc } from './supabase'
import { fmtDateTime } from './dates'

export const PHOTO_BUCKET = 'fcr-photos'
export const PHOTO_RETENTION_DAYS = 60
const MAX_SIDE = 1280
const QUALITY = 0.72

// Manila calendar date of a timestamp (PH has no daylight saving).
export const manilaYmd = (ts) => (ts ? new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10) : null)

export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`

// Phone location. Resolves null (never throws) if the KAM declines or the
// phone cannot get a fix, so the photo can still be attached and flagged.
export function getLocation(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
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

// Read the photo's own metadata, then shrink it to a ~150 KB JPEG (which also
// drops the original metadata from the stored file; we keep it as data).
export async function processPhoto(file) {
  let taken = null; let exifLat = null; let exifLng = null
  try {
    const exifr = (await import('exifr')).default
    const meta = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] })
    const d = meta?.DateTimeOriginal || meta?.CreateDate
    if (d instanceof Date && !Number.isNaN(d.getTime())) taken = d.toISOString()
    const gps = await exifr.gps(file).catch(() => null)
    if (Number.isFinite(gps?.latitude) && Number.isFinite(gps?.longitude)) { exifLat = gps.latitude; exifLng = gps.longitude }
  } catch { /* no readable metadata: fine */ }

  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale); const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', QUALITY))
  return { blob, width: w, height: h, takenAt: taken, exifLat, exifLng }
}

// Upload + attach. The location is read while the photo processes.
export async function uploadVisitPhoto({ fcrId, ownerId, file, onStep = () => {} }) {
  onStep('Reading location')
  const locP = getLocation()
  onStep('Preparing photo')
  const p = await processPhoto(file)
  const loc = await locP
  const place = loc ? await placeName(loc.lat, loc.lng) : null
  onStep('Uploading')
  const path = `${ownerId}/${fcrId}/${crypto.randomUUID()}.jpg`
  const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, p.blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(upErr.message)
  let oldPath = null
  try {
    oldPath = await rpc('attach_fcr_photo', {
      p_fcr: fcrId, p_path: path, p_taken_at: p.takenAt, p_exif_lat: p.exifLat, p_exif_lng: p.exifLng,
      p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null, p_accuracy: loc?.accuracy ?? null,
      p_place: place, p_width: p.width, p_height: p.height, p_bytes: p.blob.size,
    })
  } catch (e) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    throw e
  }
  if (oldPath) await supabase.storage.from(PHOTO_BUCKET).remove([oldPath])
  return { located: Boolean(loc) }
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
  if (photo.exif_lat != null) out.push(`Photo GPS: ${photo.exif_lat.toFixed(5)}, ${photo.exif_lng.toFixed(5)}`)
  if (photo.purged_at) out.push(`Photo file deleted ${fmtDateTime(photo.purged_at)} (${PHOTO_RETENTION_DAYS}-day retention); details kept`)
  return out
}
