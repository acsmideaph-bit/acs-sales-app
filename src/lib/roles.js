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

// People who file visits. Superiors can also file their own FCRs if they visit.
export const canFile = (profile) => canWrite(profile) && profile.role !== 'admin'

export const isGlobalReader = (profile) => ['admin', 'viewer'].includes(profile?.role)

// Who appears in team reports (dashboard overview, MCP Actual roster, weekly
// report, census, export). RSMs are approvers, not filers; add 'rsm' here if
// ACS wants RSMs' own visits counted too.
export const FILER_ROLES = ['kam']
