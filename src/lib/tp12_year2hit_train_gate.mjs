import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"

import { ensureDir, iterateJsonl, readJson, writeJson, writeJsonl } from "./io.mjs"
import {
  assertTp12OperationalHitRow,
  isTp12OperationalHitDefinition,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback
  if (value === true || value === false) return value
  const text = toText(value).toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

export const resolveTp12Year2hitPatternId = (row) =>
  toText(
    row?.patternId ??
      row?.candidatePatternId ??
      row?.candidateTemplateId ??
      row?.templateId ??
      row?.ruleId ??
      row?.id,
  )

export const resolveTp12Year2hitDateKey = (row) =>
  toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey ?? row?.matchDateKey)

export const sha256TextLines = (values = []) =>
  createHash("sha256")
    .update([...values].map((value) => toText(value)).filter(Boolean).sort().join("\n"))
    .digest("hex")

const validDateKey = (dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(toText(dateKey))
const rowHasField = (row, field) => Object.prototype.hasOwnProperty.call(row ?? {}, field)

const readHitField = (row, hitField, { hitDefinition = "", context = "" } = {}) => {
  const field = toText(hitField || "hitTarget")
  if (!field) throw new Error("hitField is required")
  if (isTp12OperationalHitDefinition(hitDefinition)) {
    if (field !== TP12_OPERATIONAL_HIT_FIELD) {
      throw new Error(`operational hit gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
    }
    assertTp12OperationalHitRow(row, { context, hitField: field })
  }
  if (!rowHasField(row, field)) {
    return { valid: false, hit: false, reason: `missing_hit_field:${field}` }
  }
  return { valid: true, hit: row[field] === true, reason: null }
}

const normalizeYears = ({ coreYears, coreYearFrom, coreYearTo } = {}) => {
  if (Array.isArray(coreYears) && coreYears.length > 0) {
    return [...new Set(coreYears.map((year) => Number(year)).filter((year) => Number.isInteger(year)))].sort(
      (a, b) => a - b,
    )
  }
  const start = Number(coreYearFrom)
  const end = Number(coreYearTo)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    throw new Error("core years are required")
  }
  const years = []
  for (let year = start; year <= end; year += 1) years.push(year)
  return years
}

const normalizeExcludedYears = (excludedBoundaryYears = []) =>
  new Set(
    (Array.isArray(excludedBoundaryYears) ? excludedBoundaryYears : String(excludedBoundaryYears).split(","))
      .map((year) => Number(String(year).trim()))
      .filter((year) => Number.isInteger(year)),
  )

const rejectCountObject = (map) =>
  Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))

export const loadTp12Year2hitTrainContract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`contract file not found: ${resolvedPath}`)
  return contract
}

export const deriveTp12Year2hitGateOptionsFromContract = (contract = {}) => {
  const trainDateRange = contract.trainDateRange ?? {}
  const gate = contract.trainGate ?? contract.year2hitGate ?? {}
  return {
    trainDateFrom:
      trainDateRange.from ??
      contract.trainDateFrom ??
      contract.decisionWindow?.from ??
      contract.splits?.find?.((split) => split?.kind === "promotion_holdout")?.trainDateFrom,
    trainDateTo:
      trainDateRange.to ??
      contract.trainDateTo ??
      contract.splits?.find?.((split) => split?.kind === "promotion_holdout")?.trainDateTo ??
      contract.splits?.find?.((split) => split?.splitId === "confirm_2024")?.trainDateTo,
    coreYears:
      contract.coreYearsRequested ??
      contract.coreYears ??
      gate.coreYears ??
      contract.searchContract?.coreYears,
    excludedBoundaryYears:
      contract.excludedBoundaryYears ??
      gate.excludedBoundaryYears ??
      contract.searchContract?.excludedBoundaryYears,
    minHitsPerYear:
      gate.minHitsPerCoreYear ??
      contract.minHitsPerCoreYear ??
      contract.minHitsPerYear ??
      contract.searchContract?.minTrainHitsPerCoreYear,
    hitDefinition: gate.hitDefinition ?? contract.hitDefinition,
    hitField:
      gate.hitField ??
      contract.operationalHit?.operationalHitField ??
      contract.oosResultGate?.hitField ??
      contract.hitField ??
      "hitTarget",
    failOnInvalidRows: gate.failOnInvalidRows ?? contract.failOnInvalidRows,
    failOnZeroSurvivors: gate.failOnZeroSurvivors ?? contract.failOnZeroSurvivors,
    requireCoreYearsWithinTrain: gate.requireCoreYearsWithinTrain ?? contract.requireCoreYearsWithinTrain,
  }
}

const assertCoreYearsWithinTrain = ({ years, trainFrom, trainTo }) => {
  const trainFromYear = Number(trainFrom.slice(0, 4))
  const trainToYear = Number(trainTo.slice(0, 4))
  const outside = years.filter((year) => year < trainFromYear || year > trainToYear)
  if (outside.length > 0) {
    throw new Error(`core years outside train date range: ${outside.join(",")}`)
  }
}

export const buildTp12Year2hitTrainGateSummary = async ({
  eventsPath,
  contractPath = null,
  trainDateFrom,
  trainDateTo,
  coreYears,
  coreYearFrom = 2017,
  coreYearTo = 2023,
  excludedBoundaryYears,
  minHitsPerYear,
  hitDefinition,
  hitField,
  failOnInvalidRows,
  failOnZeroSurvivors,
  requireCoreYearsWithinTrain,
  outPath = null,
  outRuleIdsPath = null,
  outSurvivorsPath = null,
  outRejectedPath = null,
} = {}) => {
  const contract = await loadTp12Year2hitTrainContract(contractPath)
  const contractOptions = contract ? deriveTp12Year2hitGateOptionsFromContract(contract) : {}
  const trainFrom = toText(trainDateFrom ?? contractOptions.trainDateFrom)
  const trainTo = toText(trainDateTo ?? contractOptions.trainDateTo)
  const activeCoreYears = coreYears ?? contractOptions.coreYears
  const activeExcludedBoundaryYears = excludedBoundaryYears ?? contractOptions.excludedBoundaryYears
  const activeMinHitsPerYear = minHitsPerYear ?? contractOptions.minHitsPerYear
  const activeHitField = toText(hitField ?? contractOptions.hitField ?? "hitTarget")
  const activeHitDefinition = toText(hitDefinition ?? contractOptions.hitDefinition)
  const strictInvalidRows = toBool(failOnInvalidRows ?? contractOptions.failOnInvalidRows, false)
  const strictZeroSurvivors = toBool(failOnZeroSurvivors ?? contractOptions.failOnZeroSurvivors, false)
  const strictCoreYearsWithinTrain = toBool(
    requireCoreYearsWithinTrain ?? contractOptions.requireCoreYearsWithinTrain,
    false,
  )

  if (!toText(eventsPath)) throw new Error("eventsPath is required")
  if (!trainFrom || !trainTo) throw new Error("trainDateFrom and trainDateTo are required")
  if (!validDateKey(trainFrom) || !validDateKey(trainTo) || trainFrom > trainTo) {
    throw new Error(`invalid train date range: ${trainFrom}..${trainTo}`)
  }
  const excludedYears = normalizeExcludedYears(activeExcludedBoundaryYears)
  const years = normalizeYears({ coreYears: activeCoreYears, coreYearFrom, coreYearTo }).filter(
    (year) => !excludedYears.has(year),
  )
  if (years.length < 1) throw new Error("at least one core year is required after excludedBoundaryYears")
  if (strictCoreYearsWithinTrain) {
    assertCoreYearsWithinTrain({ years, trainFrom, trainTo })
  }
  const minHits = Math.max(1, toNumber(activeMinHitsPerYear, 2))
  const byPattern = new Map()
  const invalidReasonCounts = new Map()
  let inputRowCount = 0
  let trainRowCount = 0
  let trainHitRowCount = 0
  let invalidRowCount = 0
  let outsideTrainRowCount = 0

  const recordInvalid = (reason) => {
    invalidRowCount += 1
    invalidReasonCounts.set(reason, (invalidReasonCounts.get(reason) ?? 0) + 1)
  }

  await iterateJsonl(eventsPath, {
    strict: true,
    onRow: async (row) => {
      inputRowCount += 1
      const patternId = resolveTp12Year2hitPatternId(row)
      const dateKey = resolveTp12Year2hitDateKey(row)
      if (!patternId || !dateKey) {
        recordInvalid(!patternId ? "missing_pattern_id" : "missing_date_key")
        return
      }
      if (!validDateKey(dateKey)) {
        recordInvalid("invalid_date_key")
        return
      }
      if (dateKey < trainFrom || dateKey > trainTo) {
        outsideTrainRowCount += 1
        return
      }
      trainRowCount += 1
      const hit = readHitField(row, activeHitField, {
        hitDefinition: activeHitDefinition,
        context: `${eventsPath}:${inputRowCount}`,
      })
      if (!hit.valid) {
        recordInvalid(hit.reason)
        return
      }
      const entry = byPattern.get(patternId) ?? {
        patternId,
        rowCount: 0,
        hitRowCount: 0,
        hitDatesByYear: new Map(),
      }
      entry.rowCount += 1
      if (hit.hit) {
        trainHitRowCount += 1
        entry.hitRowCount += 1
        const year = Number(dateKey.slice(0, 4))
        if (Number.isInteger(year)) {
          if (!entry.hitDatesByYear.has(year)) entry.hitDatesByYear.set(year, new Set())
          entry.hitDatesByYear.get(year).add(dateKey)
        }
      }
      byPattern.set(patternId, entry)
    },
  })

  const rejectReasonCounts = new Map()
  const survivors = []
  const rejected = []
  for (const entry of [...byPattern.values()].sort((a, b) => a.patternId.localeCompare(b.patternId))) {
    const yearHitCounts = {}
    const yearHitDates = {}
    const missingYears = []
    const belowMinYears = []
    for (const year of years) {
      const dates = [...(entry.hitDatesByYear.get(year) ?? new Set())].sort()
      yearHitCounts[String(year)] = dates.length
      yearHitDates[String(year)] = dates
      if (dates.length === 0) missingYears.push(year)
      if (dates.length < minHits) belowMinYears.push(year)
    }
    const passed = belowMinYears.length === 0
    const row = {
      patternId: entry.patternId,
      status: passed ? "passed" : "failed",
      trainRowCount: entry.rowCount,
      trainHitRowCount: entry.hitRowCount,
      minYearHits: Math.min(...years.map((year) => yearHitCounts[String(year)])),
      yearHitCounts,
      yearHitDates,
      missingYears,
      belowMinYears,
    }
    if (passed) {
      survivors.push(row)
    } else {
      const reason = missingYears.length > 0 ? "missing_year_hit" : "below_min_year_hit"
      rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
      rejected.push(row)
    }
  }

  const survivorPatternIds = survivors.map((row) => row.patternId).sort()
  const survivorPatternIdsSha256 = sha256TextLines(survivorPatternIds)
  const failures = []
  if (strictInvalidRows && invalidRowCount > 0) failures.push(`invalid_rows:${invalidRowCount}`)
  if (strictZeroSurvivors && survivorPatternIds.length < 1) failures.push("zero_survivors")

  const payload = {
    kind: "tp12_year2hit_train_gate_summary_v2",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    yearHitMetric: "unique_decision_dates",
    hitDefinition: activeHitDefinition || (activeHitField === TP12_OPERATIONAL_HIT_FIELD ? TP12_OPERATIONAL_HIT_DEFINITION : "chart_hit_v1"),
    hitField: activeHitField,
    trainDateRange: {
      from: trainFrom,
      to: trainTo,
    },
    coreYears: years,
    excludedBoundaryYears: [...excludedYears].sort((a, b) => a - b),
    minHitsPerYear: minHits,
    inputRowCount,
    trainRowCount,
    trainHitRowCount,
    outsideTrainRowCount,
    invalidRowCount,
    invalidReasonCounts: rejectCountObject(invalidReasonCounts),
    patternCount: byPattern.size,
    survivorCount: survivors.length,
    survivorPatternIds,
    survivorPatternIdsSha256,
    rejectedPatternCount: rejected.length,
    rejectReasonCounts: rejectCountObject(rejectReasonCounts),
    failures,
    survivors,
    rejected,
  }
  if (outPath) await writeJson(outPath, payload)
  if (outRuleIdsPath) {
    await ensureDir(path.dirname(outRuleIdsPath))
    await fs.writeFile(
      outRuleIdsPath,
      `${survivorPatternIds.join("\n")}${survivorPatternIds.length ? "\n" : ""}`,
      "utf8",
    )
  }
  if (outSurvivorsPath) await writeJsonl(outSurvivorsPath, survivors)
  if (outRejectedPath) await writeJsonl(outRejectedPath, rejected)
  if (failures.length > 0) {
    throw new Error(`tp12 year2hit train gate failed: ${failures.join("; ")}`)
  }
  return payload
}
