// Acknowledgement-request helpers shared by the FCR page, the RSM approval
// queue, the PDF and the Excel export, so every place describes "where the
// request went" the same way.
import { fmt, fmtDateTime } from './dates'

export const ACK_CHANNEL_LABELS = { email: 'Email', viber: 'Viber', link: 'Copied link' }

// Same rule as normalize_ph_mobile() in the database: 0917 123 4567 -> +639171234567.
export function normalizePhMobile(raw) {
  const v = String(raw || '').replace(/[^0-9+]/g, '')
  if (/^09\d{9}$/.test(v)) return '+63' + v.slice(1)
  if (/^639\d{9}$/.test(v)) return '+' + v
  if (/^\+\d{10,15}$/.test(v)) return v
  return null
}

// Pre-fill the Viber number from the account's contact number only when it
// looks like a mobile number (landlines can't receive Viber).
export const mobileFromContact = (contactNo) => (normalizePhMobile(contactNo) ? String(contactNo).trim() : '')

export const ackLink = (token) => `${window.location.origin}${window.location.pathname}#/acknowledge/${token}`

export function viberMessage({ attendeeName, kamName, company, visitDate, period, link }) {
  return [
    `Good day${attendeeName ? ` ${attendeeName}` : ''}! This is ${kamName || 'your Concepcion Midea representative'} of Concepcion Midea Inc.`,
    `Please review and confirm the minutes of our meeting${company ? ` for ${company}` : ''} on ${fmt(visitDate)} (${period === 'PM' ? 'afternoon' : 'morning'}).`,
    `It takes one click, no login needed: ${link}`,
    'Thank you!',
  ].join('\n')
}

export const viberChatUrl = (e164) => `viber://chat?number=${encodeURIComponent(e164)}`
export const viberForwardUrl = (text) => `viber://forward?text=${encodeURIComponent(text)}`

// One line for the latest request on an FCR row (fcrs.ack_* columns).
export function ackRequestLine(f) {
  if (!f?.ack_channel) return ''
  const who = [f.ack_recipient, f.ack_recipient_name && `(${f.ack_recipient_name})`].filter(Boolean).join(' ')
  return `Sent via ${ACK_CHANNEL_LABELS[f.ack_channel] || f.ack_channel}${who ? ` to ${who}` : ''}${f.ack_last_sent_at ? ` on ${fmtDateTime(f.ack_last_sent_at)}` : ''}`
}
