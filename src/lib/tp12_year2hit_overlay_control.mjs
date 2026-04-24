import { readJson, writeJson } from "./io.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const round = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}

const pickPrimary = (summary = {}) => ({
  selectedRows: toNumber(summary?.selectedRows, 0),
  hitRows: toNumber(summary?.hitRows, 0),
  hitRate: toNumber(summary?.hitRate, 0),
  usableWindowCount: toNumber(summary?.usableWindowCount, 0),
  maxTop1DateShare: toNumber(summary?.maxTop1DateShare, 0),
  uniqueMatchedDates: toNumber(summary?.uniqueMatchedDates, 0),
})

export const buildTp12Year2hitGateSummary = ({
  controlSummary,
  gatedSummary,
  comparisonLabel = "primary",
} = {}) => {
  if (!controlSummary || typeof controlSummary !== "object") {
    throw new Error("controlSummary is required")
  }
  if (!gatedSummary || typeof gatedSummary !== "object") {
    throw new Error("gatedSummary is required")
  }
  const controlScreen = pickPrimary(controlSummary?.screen?.[comparisonLabel] ?? controlSummary?.screen?.primary)
  const gatedScreen = pickPrimary(gatedSummary?.screen?.[comparisonLabel] ?? gatedSummary?.screen?.primary)
  const controlFinal = pickPrimary(controlSummary?.finalConfirm?.[comparisonLabel] ?? controlSummary?.finalConfirm?.primary)
  const gatedFinal = pickPrimary(gatedSummary?.finalConfirm?.[comparisonLabel] ?? gatedSummary?.finalConfirm?.primary)
  const retentionRatio =
    controlScreen.selectedRows > 0 ? gatedScreen.selectedRows / controlScreen.selectedRows : 0
  return {
    kind: "tp12_year2hit_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    comparisonLabel: toText(comparisonLabel || "primary"),
    controlRunId: toText(controlSummary?.runId),
    gatedRunId: toText(gatedSummary?.runId),
    controlYearHitMetric: toText(controlSummary?.yearHitMetric || controlSummary?.screen?.yearHitMetric || "hit_rows"),
    gatedYearHitMetric: toText(gatedSummary?.yearHitMetric || gatedSummary?.screen?.yearHitMetric || "hit_rows"),
    screen: {
      control: controlScreen,
      gated: gatedScreen,
      deltaHitRate: round(gatedScreen.hitRate - controlScreen.hitRate, 12),
      deltaSelectedRows: gatedScreen.selectedRows - controlScreen.selectedRows,
      deltaUniqueMatchedDates: gatedScreen.uniqueMatchedDates - controlScreen.uniqueMatchedDates,
      retentionRatio: round(retentionRatio, 12),
      deltaTop1DateShare: round(gatedScreen.maxTop1DateShare - controlScreen.maxTop1DateShare, 12),
    },
    finalConfirm: {
      control: controlFinal,
      gated: gatedFinal,
      deltaHitRate: round(gatedFinal.hitRate - controlFinal.hitRate, 12),
      deltaSelectedRows: gatedFinal.selectedRows - controlFinal.selectedRows,
      deltaUniqueMatchedDates: gatedFinal.uniqueMatchedDates - controlFinal.uniqueMatchedDates,
      deltaTop1DateShare: round(gatedFinal.maxTop1DateShare - controlFinal.maxTop1DateShare, 12),
    },
  }
}

export const writeTp12Year2hitGateSummary = async ({
  controlSummaryPath,
  gatedSummaryPath,
  outPath,
  comparisonLabel = "primary",
} = {}) => {
  const [controlSummary, gatedSummary] = await Promise.all([
    readJson(controlSummaryPath, null),
    readJson(gatedSummaryPath, null),
  ])
  const payload = buildTp12Year2hitGateSummary({
    controlSummary,
    gatedSummary,
    comparisonLabel,
  })
  await writeJson(outPath, payload)
  return payload
}
