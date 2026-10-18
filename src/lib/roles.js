// Roles drive what the UI OFFERS. What a user can actually read or change is
// decided by RLS in the database; approval rights come from supervisor_id
// (the org chart), not from these labels.

export const ROLE_LABELS = {
  kam: 'Key Account Manager',
  rsm: 'Regional Sales Manager',
  channel_head: 'Channel Head',
  director: 'Director',
  admin: 'Admin',
  viewer: 'Viewer (read-only)',
}

export const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const ACK_LABELS = {
  not_sent: 'Not sent',
  pending: 'Awaiting customer',
  acknowledged: 'Acknowledged',
}

export const canWrite = (profile) =>
  Boolean(profile && profile.active && !profile.read_only && profile.role !== 'viewer')

// KAMs file FCRs and MCP Plans (confirmed by Ronald, Oct 14, 2026: RSMs
// do not submit to the Channel Head, and the Channel Head does not submit to
// the Director). The database enforces the same rule (fcrs_insert,
// itin_insert policies).
// Exception (Ronald, Oct 18, 2026): a non-KAM the TTA plan assigns dealers to
// (an RSM covering accounts until he assigns them to his team) also files,
// for those dealers only. Same rule in the database (is_filer()).
export const canFile = (profile, holdsDealers = false) => canWrite(profile) && (profile.role === 'kam' || holdsDealers)

export const isGlobalReader = (profile) => ['admin', 'viewer'].includes(profile?.role)

// Who appears in team reports (dashboard overview, MCP Actual roster, weekly
// report, census, export): KAMs, plus anyone holding dealers in the TTA plan
// this year (see isFiler / fetchFilers in lib/data.js).
export const FILER_ROLES = ['kam']
