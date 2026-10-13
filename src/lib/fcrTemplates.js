// FCR templates -- the ACS paper forms as data.
//
// Source: "FCR - ACS.pdf" (dealer accounts) and "FCR - SUB D.pdf" (sub-dealer
// accounts), Concepcion Midea Inc. Philippines, Oct 2026.
//
// When ACS changes a form: edit the template here and bump `version`. Keep the
// old version in TEMPLATES so FCRs filed under it still render (each FCR
// stores template_id + template_version). No database migration is needed --
// answers live in fcrs.form_data (jsonb), keyed by section key.
//
// Section kinds
//   text   -> value: string
//   grid   -> value: { f: {fieldKey: value}, rows: [{colKey: value}] }
//             fixedRows: first column is a fixed label per row (rowKey stores it)
//             rows/addable: blank rows, user may add more
//   matrix -> value: { period: 'Q1', v: { [group]: { [metric]: { [col]: number } } } }
//             computed metrics/columns are derived, never stored

const competitive = {
  key: 'competitive_check', title: 'Competitive Check', kind: 'grid',
  rows: 6, addable: true, maxRows: 12,
  columns: [
    { key: 'brand', label: 'Brand', width: '16%', suggest: ['Daikin', 'Carrier', 'Panasonic', 'LG', 'Samsung', 'Gree', 'Hisense', 'TCL', 'Kolin', 'Aux', 'Condura', 'Haier'] },
    { key: 'initiative', label: 'Initiative', width: '18%' },
    { key: 'duration', label: 'Duration', width: '14%' },
    { key: 'mechanics', label: 'Mechanics', width: '26%' },
    { key: 'notes', label: 'Notes' },
  ],
}

const programColumns = [
  { key: 'status', label: 'Status', width: '16%', suggest: ['Not started', 'In progress', 'Completed', 'On hold', 'Not applicable'] },
  { key: 'date', label: 'Date', type: 'date', width: '15%' },
  { key: 'next_steps', label: 'Next Steps', width: '30%' },
  { key: 'notes', label: 'Notes' },
]

const getBack = {
  key: 'get_back_items', title: 'Customer Get Back Items', kind: 'text', rowsHint: 5,
  placeholder: 'What did we commit to get back to the customer on? One item per line, with the date.',
}

const projects = {
  key: 'project_opportunities', title: 'Project Opportunities - Under Negotiation', kind: 'grid',
  rows: 3, addable: true, maxRows: 15,
  columns: [
    { key: 'project_name_owner', label: 'Project Name / Owner', width: '20%' },
    { key: 'address', label: 'Address', width: '14%' },
    { key: 'amount', label: 'Amount (PHP)', type: 'number', width: '12%' },
    { key: 'rollout', label: 'Roll-out', width: '10%' },
    { key: 'consultant', label: 'Consultant', width: '12%' },
    { key: 'status', label: 'Status', width: '11%', suggest: ['Inquiry', 'Quoted', 'Negotiation', 'Verbal award', 'PO received', 'Delivered', 'Lost'] },
    { key: 'next_steps', label: 'Next Steps' },
  ],
  totals: ['amount'],
}

const coverage = {
  key: 'coverage_notes', title: 'Coverage Notes', kind: 'text', rowsHint: 6,
  placeholder: 'What happened on this visit: who you met, what was discussed, outcomes.',
}

const ACS_DEALER_V1 = {
  id: 'acs_dealer',
  version: 1,
  title: 'FIELD CONTACT REPORT - ACS',
  shortTitle: 'ACS (Dealer)',
  accountType: 'dealer',
  header: {
    classificationLabel: 'Dealer Classification',
    channelLabel: 'Channel',
  },
  sections: [
    {
      key: 'program_execution', title: 'CMIP Program Execution Check', kind: 'grid',
      rowKey: 'program', rowLabel: 'Program',
      fixedRows: ['Dealer Accreditation', 'Service Center Accreditation', 'Product Training', 'Module and Mock-up Deployment', 'Product Brochures'],
      columns: programColumns,
    },
    competitive,
    getBack,
    {
      key: 'ar_collection', title: 'AR and Collection Update', kind: 'grid',
      fields: [
        { key: 'payment_terms', label: 'Payment Terms', fromAccount: 'payment_terms' },
        { key: 'credit_limit', label: 'Credit Limit (PHP)', type: 'number', fromAccount: 'credit_limit' },
      ],
      rows: 4, addable: true, maxRows: 12,
      columns: [
        { key: 'amount', label: 'AR Overdue Amount (PHP)', type: 'number', width: '17%' },
        { key: 'reason', label: 'Reason', width: '22%' },
        { key: 'commitment_date', label: 'Commitment Date', type: 'date', width: '15%' },
        { key: 'next_steps', label: 'Next Steps', width: '24%' },
        { key: 'contact', label: 'Contact' },
      ],
      totals: ['amount'],
    },
    {
      key: 'tta_trip', title: 'Sales Update - TTA Trip Goal', kind: 'grid',
      rowKey: 'trip', rowLabel: 'Trip',
      fixedRows: ['Vietnam (5M)', 'Spain (20M)', 'Others'],
      editableRowLabels: ['Others'],
      columns: [
        { key: 'pax', label: 'Pax', type: 'number', width: '18%' },
        { key: 'per_pax', label: 'Per Pax (PHP)', type: 'number', width: '22%' },
        { key: 'target', label: 'Target (PHP)', type: 'number' },
      ],
      totals: ['target'],
    },
    {
      key: 'product_targets', title: 'Sales Update - Target vs Sales', kind: 'matrix',
      periodLabel: 'Quarter', periods: ['Q1', 'Q2', 'Q3', 'Q4'],
      groups: ['Light Commercial', 'High Wall', 'Window'],
      metrics: [
        { key: 'target', label: 'Target' },
        { key: 'sales', label: 'Sales' },
        { key: 'balance', label: 'Balance to Hit', computed: 'target-sales' },
      ],
      columns: [
        { key: 'm1', label: 'Month 1' },
        { key: 'm2', label: 'Month 2' },
        { key: 'm3', label: 'Month 3' },
        { key: 'qtr', label: 'Quarter', computed: ['m1', 'm2', 'm3'] },
        { key: 'fy', label: 'FY Target' },
        { key: 'ytd', label: 'Act YTD' },
      ],
      monthLabels: {
        Q1: ['Jan', 'Feb', 'Mar'], Q2: ['Apr', 'May', 'Jun'], Q3: ['Jul', 'Aug', 'Sep'], Q4: ['Oct', 'Nov', 'Dec'],
      },
    },
    projects,
    {
      key: 'sub_dealers_program', title: 'Sub-Dealers Program', kind: 'grid',
      rows: 5, addable: true, maxRows: 20,
      columns: [
        { key: 'client_name', label: 'Client Name', width: '22%' },
        { key: 'pro_shop', label: 'Pro Shop', width: '11%' },
        { key: 'midea_club', label: 'Midea Club', width: '11%' },
        { key: 'trainings', label: 'Trainings', width: '14%' },
        { key: 'marketing_materials', label: 'Marketing Materials', width: '16%' },
        { key: 'next_steps', label: 'Next Steps' },
      ],
    },
    {
      key: 'cycle_initiatives', title: 'Cycle Initiatives (Programs / Trainings)', kind: 'grid',
      rowKey: 'quarter', rowLabel: 'Quarter',
      fixedRows: ['Q1', 'Q2', 'Q3', 'Q4'],
      columns: [
        { key: 'initiative', label: 'Program / Training', width: '50%' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    coverage,
  ],
}

const ACS_SUB_DEALER_V1 = {
  id: 'acs_sub_dealer',
  version: 1,
  title: 'FIELD CONTACT REPORT - SUB DEALER',
  shortTitle: 'Sub Dealer',
  accountType: 'sub_dealer',
  header: {
    classificationLabel: 'Classification',
    channelLabel: 'Dealer',
  },
  sections: [
    {
      key: 'program_execution', title: 'CMIP Program Execution Check', kind: 'grid',
      rowKey: 'program', rowLabel: 'Program',
      fixedRows: ['Pro Shop', 'Midea Club', 'Trainings', 'Other Marketing'],
      columns: programColumns,
    },
    competitive,
    getBack,
    {
      key: 'sell_through', title: 'Sales Update - Sell-in / Sell-out', kind: 'matrix',
      periodLabel: 'Half', periods: ['H1', 'H2'],
      groups: ['High Wall', 'Light Commercial'],
      metrics: [
        { key: 'sell_in', label: 'Dealer Purchase / Sell In' },
        { key: 'sell_out', label: 'Sell Out' },
        { key: 'claimed', label: 'Claimed in Midea Club' },
      ],
      columns: [
        { key: 'm1', label: 'Month 1' }, { key: 'm2', label: 'Month 2' }, { key: 'm3', label: 'Month 3' },
        { key: 'm4', label: 'Month 4' }, { key: 'm5', label: 'Month 5' }, { key: 'm6', label: 'Month 6' },
        { key: 'qa', label: 'Qtr A', computed: ['m1', 'm2', 'm3'] },
        { key: 'qb', label: 'Qtr B', computed: ['m4', 'm5', 'm6'] },
        { key: 'half', label: 'Half', computed: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] },
      ],
      monthLabels: {
        H1: ['January', 'February', 'March', 'April', 'May', 'June', 'Q1', 'Q2', 'H1'],
        H2: ['July', 'August', 'September', 'October', 'November', 'December', 'Q3', 'Q4', 'H2'],
      },
    },
    projects,
    coverage,
  ],
}

export const TEMPLATES = {
  'acs_dealer@1': ACS_DEALER_V1,
  'acs_sub_dealer@1': ACS_SUB_DEALER_V1,
}

// Latest version per template id -- what new FCRs are filed under.
export const CURRENT = {
  acs_dealer: ACS_DEALER_V1,
  acs_sub_dealer: ACS_SUB_DEALER_V1,
}

export const templateFor = (id, version) =>
  TEMPLATES[`${id}@${version}`] || CURRENT[id] || ACS_DEALER_V1

export const templateForAccountType = (accountType) =>
  accountType === 'sub_dealer' ? CURRENT.acs_sub_dealer : CURRENT.acs_dealer

// ---------------------------------------------------------------------------
// Empty values
// ---------------------------------------------------------------------------

const blankRow = (section, label) => {
  const row = Object.fromEntries(section.columns.map((c) => [c.key, '']))
  if (section.rowKey) row[section.rowKey] = label
  return row
}

export const emptySection = (section) => {
  if (section.kind === 'text') return ''
  if (section.kind === 'matrix') return { period: section.periods[0], v: {} }
  const rows = section.fixedRows
    ? section.fixedRows.map((l) => blankRow(section, l))
    : Array.from({ length: section.rows || 1 }, () => blankRow(section))
  const f = Object.fromEntries((section.fields || []).map((fl) => [fl.key, '']))
  return { f, rows }
}

export const emptyFormData = (template, account) => {
  const data = Object.fromEntries(template.sections.map((s) => [s.key, emptySection(s)]))
  // Pre-fill header fields that the account already knows (payment terms...).
  for (const s of template.sections) {
    for (const fl of s.fields || []) {
      if (fl.fromAccount && account?.[fl.fromAccount] != null) data[s.key].f[fl.key] = String(account[fl.fromAccount])
    }
  }
  if (template.id === 'acs_dealer') {
    data.product_targets.period = currentQuarter()
  } else {
    data.sell_through.period = new Date().getMonth() < 6 ? 'H1' : 'H2'
  }
  return data
}

// Merge saved data over a blank shape so new template fields never crash old
// records, and fixed rows keep their order.
export const normalizeFormData = (template, saved) => {
  const out = {}
  for (const s of template.sections) {
    const blank = emptySection(s)
    const v = saved?.[s.key]
    if (s.kind === 'text') out[s.key] = typeof v === 'string' ? v : ''
    else if (s.kind === 'matrix') out[s.key] = { ...blank, ...(v || {}), v: v?.v || {} }
    else {
      let rows = Array.isArray(v?.rows) ? v.rows.map((r) => ({ ...blankRow(s), ...r })) : blank.rows
      if (s.fixedRows) {
        rows = s.fixedRows.map((label, i) => ({ ...blankRow(s, label), ...(rows[i] || {}), [s.rowKey]: (s.editableRowLabels?.includes(label) ? (rows[i]?.[s.rowKey] || label) : label) }))
      }
      out[s.key] = { f: { ...blank.f, ...(v?.f || {}) }, rows }
    }
  }
  return out
}

export const currentQuarter = (d = new Date()) => `Q${Math.floor(d.getMonth() / 3) + 1}`

// ---------------------------------------------------------------------------
// Values and computations
// ---------------------------------------------------------------------------

export const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[,\s₱]/g, ''))
  return Number.isFinite(n) ? n : null
}

export const peso = (v, { blank = '' } = {}) => {
  const n = num(v)
  if (n == null) return blank
  return n.toLocaleString('en-PH', { maximumFractionDigits: 2 })
}

const rowHasContent = (section, row) =>
  section.columns.some((c) => String(row?.[c.key] ?? '').trim() !== '')

export const filledRows = (section, value) => (value?.rows || []).filter((r) => rowHasContent(section, r))

export const columnTotal = (value, colKey) =>
  (value?.rows || []).reduce((sum, r) => sum + (num(r[colKey]) || 0), 0)

// matrix cell: stored, computed column (sum), or computed metric (a-b)
export const matrixCell = (section, value, group, metricKey, colKey) => {
  const metric = section.metrics.find((m) => m.key === metricKey)
  const col = section.columns.find((c) => c.key === colKey)
  if (metric?.computed) {
    const [a, b] = metric.computed.split('-')
    const va = matrixCell(section, value, group, a, colKey)
    const vb = matrixCell(section, value, group, b, colKey)
    if (va == null && vb == null) return null
    return (va || 0) - (vb || 0)
  }
  if (col?.computed) {
    const parts = col.computed.map((k) => num(value?.v?.[group]?.[metricKey]?.[k]))
    if (parts.every((p) => p == null)) return null
    return parts.reduce((s, p) => s + (p || 0), 0)
  }
  return num(value?.v?.[group]?.[metricKey]?.[colKey])
}

export const matrixColumnLabels = (section, period) => {
  const labels = section.monthLabels?.[period]
  return section.columns.map((c, i) => (labels?.[i] ? labels[i] : c.label))
}

export const matrixHasContent = (section, value) =>
  section.groups.some((g) => section.metrics.some((m) => !m.computed && section.columns.some((c) => !c.computed && num(value?.v?.[g]?.[m.key]?.[c.key]) != null)))

export const sectionHasContent = (section, value) => {
  if (section.kind === 'text') return Boolean(String(value || '').trim())
  if (section.kind === 'matrix') return matrixHasContent(section, value)
  const fieldsFilled = (section.fields || []).some((f) => String(value?.f?.[f.key] ?? '').trim())
  return fieldsFilled || filledRows(section, value).length > 0
}

// ---------------------------------------------------------------------------
// Customer information header (snapshot stored on the FCR at filing time)
// ---------------------------------------------------------------------------

export const customerInfoFromAccount = (account, { kamName, parentDealerName } = {}) => ({
  company_name: account?.company_name || '',
  owners: account?.owners || '',
  contact_no: account?.contact_no || '',
  dealer_classification: account?.account_type === 'sub_dealer' ? 'SUB DEALER' : (account?.dealer_classification || ''),
  business_address: account?.business_address || '',
  region: account?.region || '',
  email: account?.email || '',
  channel: account?.account_type === 'sub_dealer' ? (parentDealerName || '') : (account?.channel || ''),
  ase_tse: kamName || '',
  visit_freq_days: account?.visit_freq_days || '',
})

export const HEADER_FIELDS = (template) => [
  ['company_name', 'Company Name'],
  ['business_address', 'Business Address'],
  ['owners', 'Owner/s'],
  ['region', 'Region'],
  ['contact_no', 'Contact No.'],
  ['email', 'E-Mail Address'],
  ['dealer_classification', template.header.classificationLabel],
  ['channel', template.header.channelLabel],
]
