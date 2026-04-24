import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const rowDecisionDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)

const finiteMetric = (row, keys) => {
  for (const key of keys) {
    const value = toNumber(row?.[key], NaN)
    if (Number.isFinite(value)) return value
  }
  return NaN
}

const classifyRow = ({
  row,
  targetPct,
  nearMissMinPct,
  hardNegativeMaxForwardReturnPct,
  requirePathMetrics,
  targetBoundaryTolerance,
}) => {
  const hitTarget = row.hitTarget === true
  const maxForwardReturn = finiteMetric(row, ["maxForwardReturn", "maxForwardHighPct", "forwardMaxReturn"])
  const minForwardReturn = finiteMetric(row, ["minForwardReturn", "minForwardLowPct", "maxForwardDrawdown"])
  if (hitTarget) {
    return {
      labelClass: "positive",
      maxForwardReturn,
      minForwardReturn,
      classificationReason: "hit_target_true",
    }
  }
  if (!Number.isFinite(maxForwardReturn)) {
    if (toBool(requirePathMetrics, true)) {
      throw new Error("non-hit hard-negative classification requires maxForwardReturn/maxForwardHighPct")
    }
    return {
      labelClass: "negative_unqualified",
      maxForwardReturn: null,
      minForwardReturn: Number.isFinite(minForwardReturn) ? minForwardReturn : null,
      classificationReason: "missing_path_metrics",
    }
  }
  if (maxForwardReturn > targetPct + targetBoundaryTolerance) {
    throw new Error(`hitTarget=false but maxForwardReturn reaches targetPct: ${maxForwardReturn} >= ${targetPct}`)
  }
  if (maxForwardReturn >= nearMissMinPct) {
    return {
      labelClass: "near_miss",
      maxForwardReturn,
      minForwardReturn: Number.isFinite(minForwardReturn) ? minForwardReturn : null,
      classificationReason: "non_hit_near_target",
    }
  }
  if (maxForwardReturn <= hardNegativeMaxForwardReturnPct) {
    return {
      labelClass: "hard_negative",
      maxForwardReturn,
      minForwardReturn: Number.isFinite(minForwardReturn) ? minForwardReturn : null,
      classificationReason: "low_forward_return",
    }
  }
  return {
    labelClass: "easy_negative",
    maxForwardReturn,
    minForwardReturn: Number.isFinite(minForwardReturn) ? minForwardReturn : null,
    classificationReason: "middle_negative",
  }
}

export const buildTp12HardNegativeDataset = async ({
  inputPath,
  outPath,
  manifestPath,
  dateFrom = "",
  dateTo = "",
  forbiddenDateFrom = "",
  forbiddenDateTo = "",
  targetPct = 0.12,
  nearMissMinPct = 0.08,
  hardNegativeMaxForwardReturnPct = 0.04,
  requirePathMetrics = true,
  targetBoundaryTolerance = 1e-9,
} = {}) => {
  if (!toText(inputPath)) throw new Error("inputPath is required")
  if (!fs.existsSync(inputPath)) throw new Error(`input path not found: ${inputPath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(manifestPath)) throw new Error("manifestPath is required")
  const normalizedTargetPct = toNumber(targetPct, 0.12)
  const normalizedNearMissMinPct = toNumber(nearMissMinPct, 0.08)
  const normalizedHardNegativeMaxForwardReturnPct = toNumber(hardNegativeMaxForwardReturnPct, 0.04)
  const normalizedTargetBoundaryTolerance = toNumber(targetBoundaryTolerance, 1e-9)
  const normalizedDateFrom = toText(dateFrom)
  const normalizedDateTo = toText(dateTo)
  const normalizedForbiddenDateFrom = toText(forbiddenDateFrom)
  const normalizedForbiddenDateTo = toText(forbiddenDateTo)
  if (!Number.isFinite(normalizedTargetPct) || normalizedTargetPct <= 0) throw new Error(`invalid targetPct: ${targetPct}`)
  if (!Number.isFinite(normalizedTargetBoundaryTolerance) || normalizedTargetBoundaryTolerance < 0) {
    throw new Error(`invalid targetBoundaryTolerance: ${targetBoundaryTolerance}`)
  }
  if (!Number.isFinite(normalizedNearMissMinPct) || normalizedNearMissMinPct < 0) {
    throw new Error(`invalid nearMissMinPct: ${nearMissMinPct}`)
  }
  if (!Number.isFinite(normalizedHardNegativeMaxForwardReturnPct) || normalizedHardNegativeMaxForwardReturnPct < 0) {
    throw new Error(`invalid hardNegativeMaxForwardReturnPct: ${hardNegativeMaxForwardReturnPct}`)
  }
  if (normalizedHardNegativeMaxForwardReturnPct > normalizedNearMissMinPct) {
    throw new Error("hardNegativeMaxForwardReturnPct must be <= nearMissMinPct")
  }
  if (normalizedNearMissMinPct >= normalizedTargetPct) throw new Error("nearMissMinPct must be < targetPct")
  if (normalizedDateFrom && !validDateKey(normalizedDateFrom)) throw new Error(`invalid dateFrom: ${normalizedDateFrom}`)
  if (normalizedDateTo && !validDateKey(normalizedDateTo)) throw new Error(`invalid dateTo: ${normalizedDateTo}`)
  if (normalizedDateFrom && normalizedDateTo && normalizedDateFrom > normalizedDateTo) throw new Error("dateFrom must be <= dateTo")
  if (normalizedForbiddenDateFrom && !validDateKey(normalizedForbiddenDateFrom)) {
    throw new Error(`invalid forbiddenDateFrom: ${normalizedForbiddenDateFrom}`)
  }
  if (normalizedForbiddenDateTo && !validDateKey(normalizedForbiddenDateTo)) {
    throw new Error(`invalid forbiddenDateTo: ${normalizedForbiddenDateTo}`)
  }
  if (normalizedForbiddenDateFrom && normalizedForbiddenDateTo && normalizedForbiddenDateFrom > normalizedForbiddenDateTo) {
    throw new Error("forbiddenDateFrom must be <= forbiddenDateTo")
  }
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  const labelClassCounts = new Map()
  const reasonCounts = new Map()
  const byYearCounts = new Map()
  const byYearClassCounts = new Map()
  let inputRowCount = 0
  let outputRowCount = 0
  try {
    await iterateJsonlMaybeGzip(inputPath, {
      strict: true,
      onRow: async (row, context) => {
        inputRowCount += 1
        const symbol = rowSymbol(row)
        const decisionDateKey = rowDecisionDateKey(row)
        if (!symbol) throw new Error(`row missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
        }
        if (normalizedDateFrom && decisionDateKey < normalizedDateFrom) {
          throw new Error(`row before allowed train dateFrom at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (normalizedDateTo && decisionDateKey > normalizedDateTo) {
          throw new Error(`row after allowed train dateTo at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (
          normalizedForbiddenDateFrom &&
          normalizedForbiddenDateTo &&
          decisionDateKey >= normalizedForbiddenDateFrom &&
          decisionDateKey <= normalizedForbiddenDateTo
        ) {
          throw new Error(`row falls inside forbidden date range at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
          throw new Error(`row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
        }
        const classified = classifyRow({
          row,
          targetPct: normalizedTargetPct,
          nearMissMinPct: normalizedNearMissMinPct,
          hardNegativeMaxForwardReturnPct: normalizedHardNegativeMaxForwardReturnPct,
          requirePathMetrics,
          targetBoundaryTolerance: normalizedTargetBoundaryTolerance,
        })
        const year = decisionDateKey.slice(0, 4)
        incrementMap(labelClassCounts, classified.labelClass)
        incrementMap(reasonCounts, classified.classificationReason)
        incrementMap(byYearCounts, year)
        incrementMap(byYearClassCounts, `${year}:${classified.labelClass}`)
        await writeJsonlRow(stream, {
          kind: "tp12_hard_negative_dataset_row_v1",
          symbol,
          decisionDateKey,
          patternId: toText(row?.patternId) || null,
          supportPatternCount: toNumber(row?.supportPatternCount, null),
          supportClusterCount: toNumber(row?.supportClusterCount, null),
          hitTarget: row.hitTarget === true,
          ...classified,
        })
        outputRowCount += 1
      },
    })
  } finally {
    await closeWriteStream(stream)
  }
  const manifest = {
    kind: "tp12_hard_negative_dataset_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    inputPath: path.resolve(inputPath),
    outPath: path.resolve(outPath),
    options: {
      targetPct: normalizedTargetPct,
      nearMissMinPct: normalizedNearMissMinPct,
      hardNegativeMaxForwardReturnPct: normalizedHardNegativeMaxForwardReturnPct,
      requirePathMetrics: toBool(requirePathMetrics, true),
      targetBoundaryTolerance: normalizedTargetBoundaryTolerance,
      dateFrom: normalizedDateFrom || null,
      dateTo: normalizedDateTo || null,
      forbiddenDateFrom: normalizedForbiddenDateFrom || null,
      forbiddenDateTo: normalizedForbiddenDateTo || null,
    },
    inputRowCount,
    outputRowCount,
    labelClassCounts: mapToSortedObject(labelClassCounts),
    reasonCounts: mapToSortedObject(reasonCounts),
    byYearCounts: mapToSortedObject(byYearCounts),
    byYearClassCounts: mapToSortedObject(byYearClassCounts),
  }
  await writeJson(manifestPath, manifest)
  return manifest
}
