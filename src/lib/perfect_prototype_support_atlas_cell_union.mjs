export const buildPerfectPrototypeSupportAtlasCellUnionKey = (cells = []) =>
  (Array.isArray(cells) ? cells : [])
    .map((cell) => String(cell?.cellId ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join("+")

export const buildPerfectPrototypeSupportAtlasCellUnionSummary = (cells = []) => ({
  atlasCellUnionCount: Math.max(0, (Array.isArray(cells) ? cells : []).length - 1),
  unionCellIds: (Array.isArray(cells) ? cells : []).map((cell) => cell?.cellId ?? null).filter(Boolean),
  unionKey: buildPerfectPrototypeSupportAtlasCellUnionKey(cells),
})
