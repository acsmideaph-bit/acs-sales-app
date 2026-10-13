// PDF/Excel/zip libraries are ~1.5 MB. Load them only when someone actually
// exports, so the app opens fast on a phone in the field.
export const downloadFcrPdf = async (args) => (await import('./pdf')).downloadFcrPdf(args)
export const downloadMcpPdf = async (args, name) => (await import('./pdf')).downloadMcpPdf(args, name)
export const downloadSnapshotPdf = async (snap, name) => {
  const m = await import('./pdf')
  return m.downloadMcpPdf(m.snapshotToMcpArgs(snap), name)
}
export const combinedFcrPdf = async (fcrs) => (await import('./bundle')).combinedFcrPdf(fcrs)
export const reportZip = async (args) => (await import('./bundle')).reportZip(args)
export const saveExportWorkbook = async (args, name) => {
  const x = await import('./excel')
  x.saveWorkbook(x.buildExportWorkbook(args), name)
}
export const saveCensusWorkbook = async (args, name) => {
  const x = await import('./excel')
  x.saveWorkbook(x.buildCensusWorkbook(args), name)
}
