import JSZip from 'jszip'
import { renderFcr, newDoc, fcrPdfBlob, fcrFileName, mcpPdfBlob } from './pdf'
import { fetchActualVisits, fetchPlans } from './mcp'

// One combined PDF of many FCRs (Export Center "PDF").
export async function combinedFcrPdf(fcrs) {
  const doc = newDoc()
  let first = true
  for (const f of fcrs) {
    await renderFcr(doc, { fcr: f, submitterName: f.owner_name, submitterPosition: f.owner_position, reviewerName: f.reviewer_name, firstPage: first })
    first = false
  }
  return doc.output('blob')
}

// Zip: FCRs/<KAM>/<file>.pdf and MCP Actual/<KAM> <month>.pdf
export async function reportZip({ fcrs, ownerIds, byId, months, onProgress }) {
  const zip = new JSZip()
  let n = 0
  const total = fcrs.length + ownerIds.length * months.length
  for (const f of fcrs) {
    const blob = await fcrPdfBlob({ fcr: f, submitterName: f.owner_name, submitterPosition: f.owner_position, reviewerName: f.reviewer_name })
    zip.folder('FCRs').folder(f.owner_name || 'Unknown').file(fcrFileName(f, f.owner_name), blob)
    onProgress?.(++n, total)
  }
  for (const month of months) {
    const [visits, plans] = await Promise.all([fetchActualVisits({ ownerIds, month }), fetchPlans({ ownerIds, month })])
    for (const id of ownerIds) {
      const mine = visits.filter((v) => v.owner_id === id)
      const planned = plans.find((p) => p.owner_id === id)?.visits?.length
      const blob = mcpPdfBlob({
        title: 'MCP Actual', month, ownerName: byId[id]?.full_name || '', ownerTeam: byId[id]?.team,
        items: mine.map((v) => ({ ...v, label: v.company })),
        summary: `${mine.length} approved visit(s)${planned != null ? ` of ${planned} planned` : ''} · live as of download`,
      })
      zip.folder('MCP Actual').file(`${byId[id]?.full_name || id} ${month.slice(0, 7)}.pdf`, blob)
      onProgress?.(++n, total)
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

