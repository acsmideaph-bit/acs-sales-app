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

// Only KAMs file FCRs and MCP Plans (confirmed by Ronald, Oct 14, 2026: RSMs
// do not submit to the Channel Head, and the Channel Head does not submit to
// the Director). The database enforces the same rule (fcrs_insert,
// itin_insert policies).
export const canFile = (profile) => canWrite(profile) && profile.role === 'kam'

export const isGlobalReader = (profile) => ['admin', 'viewer'].includes(profile?.role)

// Who appears in team reports (dashboard overview, MCP Actual roster, weekly
// report, census, export). RSMs are approvers, not filers; add 'rsm' here if
// ACS wants RSMs' own visits counted too.
export const FILER_ROLES = ['kam']
