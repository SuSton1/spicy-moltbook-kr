import fs from "node:fs"
import path from "node:path"

import { writeJson } from "./io.mjs"
import { iterateJsonlMaybeGzip, toNumber, toText, uniqueSorted, validDateKey } from "./tp12_year2hit_foundation_io.mjs"

const rowDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey)

const parseYears = (value) =>
  (Array.isArray(value) ? value : toText(value).split(","))
    .map((item) => Number(toText(item)))
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => left - right)

const loadDecisionDates = async ({ candidateEventsPath = "", calendarPath = "", dateFrom = "", dateTo = "" } = {}) => {
  const sourcePath = toText(candidateEventsPath) || toText(calendarPath)
  if (!sourcePath) throw new Error("candidateEventsPath or calendarPath is required")
  if (!fs.existsSync(sourcePath)) throw new Error(`split date source not found: ${sourcePath}`)
  const dates = new Set()
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row, context) => {
      const dateKey = rowDateKey(row)
      if (!validDateKey(dateKey)) {
        throw new Error(`invalid split date at ${context.filePath}:${context.lineNumber}: ${dateKey || "missing"}`)
      }
      if (toText(dateFrom) && dateKey < toText(dateFrom)) return
      if (toText(dateTo) && dateKey > toText(dateTo)) return
      dates.add(dateKey)
    },
  })
  const sorted = [...dates].sort()
  if (sorted.length < 2) throw new Error(`split date source produced fewer than two dates: ${sourcePath}`)
  return { dates: sorted, sourcePath: path.resolve(sourcePath) }
}

const yearOf = (dateKey) => Number(dateKey.slice(0, 4))

const buildForwardDateKeys = ({ dates, startDateKey, horizonBars }) => {
  const startIndex = dates.indexOf(startDateKey)
  if (startIndex < 0) throw new Error(`forward horizon start date not present: ${startDateKey}`)
  const out = []
  for (let offset = 1; offset <= horizonBars; offset += 1) {
    const next = dates[startIndex + offset]
    if (!next) break
    out.push(next)
  }
  return out
}

const countLabelHorizonOverlaps = ({ dates, trainDates, validationDates, labelHorizonBars }) => {
  const validationSet = new Set(validationDates)
  let overlappingTrainDecisionDateCount = 0
  const samples = []
  for (const dateKey of trainDates) {
    const forwardDateKeys = buildForwardDateKeys({ dates, startDateKey: dateKey, horizonBars: labelHorizonBars })
    const overlappingForwardDateKeys = forwardDateKeys.filter((forwardDateKey) => validationSet.has(forwardDateKey))
    if (overlappingForwardDateKeys.length < 1) continue
    overlappingTrainDecisionDateCount += 1
    if (samples.length < 20) {
      samples.push({ trainDecisionDateKey: dateKey, overlappingForwardDateKeys })
    }
  }
  return { overlappingTrainDecisionDateCount, samples }
}

const buildFold = ({ foldId, dates, validationYear, purgeBars, embargoBars, labelHorizonBars }) => {
  const validationDates = dates.filter((dateKey) => yearOf(dateKey) === validationYear)
  if (validationDates.length < 1) throw new Error(`validation year has no dates: ${validationYear}`)
  const validationSet = new Set(validationDates)
  const firstValidationIndex = dates.indexOf(validationDates[0])
  const lastValidationIndex = dates.indexOf(validationDates.at(-1))
  const purgeStartIndex = Math.max(0, firstValidationIndex - purgeBars)
  const embargoEndIndex = Math.min(dates.length - 1, lastValidationIndex + embargoBars)
  const blockedDates = new Set(dates.slice(purgeStartIndex, embargoEndIndex + 1))
  const trainDates = dates.filter((dateKey, index) => index < purgeStartIndex && !validationSet.has(dateKey) && !blockedDates.has(dateKey))
  const trainSet = new Set(trainDates)
  const overlap = validationDates.filter((dateKey) => trainSet.has(dateKey))
  if (overlap.length > 0) throw new Error(`split fold overlap for ${foldId}: ${overlap.slice(0, 5).join(",")}`)
  const labelHorizonOverlap = countLabelHorizonOverlaps({
    dates,
    trainDates,
    validationDates,
    labelHorizonBars,
  })
  return {
    foldId,
    validationYear,
    trainYears: uniqueSorted(trainDates.map((dateKey) => String(yearOf(dateKey)))).map(Number),
    validationYears: [validationYear],
    trainDateCount: trainDates.length,
    validationDateCount: validationDates.length,
    purgeBars,
    embargoBars,
    labelHorizonBars,
    purgeDateCount: firstValidationIndex - purgeStartIndex,
    embargoDateCount: embargoEndIndex - lastValidationIndex,
    labelHorizonOverlap,
    trainDateRange: trainDates.length > 0 ? { from: trainDates[0], to: trainDates.at(-1) } : null,
    validationDateRange: { from: validationDates[0], to: validationDates.at(-1) },
    blockedDateRange: { from: dates[purgeStartIndex], to: dates[embargoEndIndex] },
    trainDates,
    validationDates,
  }
}

const buildInnerFolds = ({ outerFold, dates, purgeBars, embargoBars, labelHorizonBars }) => {
  const trainDateSet = new Set(outerFold.trainDates)
  const trainDates = dates.filter((dateKey) => trainDateSet.has(dateKey))
  const trainYears = uniqueSorted(trainDates.map((dateKey) => String(yearOf(dateKey)))).map(Number)
  return trainYears
    .slice(1)
    .map((validationYear) =>
      buildFold({
        foldId: `${outerFold.foldId}__inner_${validationYear}`,
        dates: trainDates,
        validationYear,
        purgeBars,
        embargoBars,
        labelHorizonBars,
      }),
    )
    .filter((fold) => fold.trainDateCount > 0)
}

export const buildTp12NestedSplitPlan = async ({
  candidateEventsPath = "",
  calendarPath = "",
  outPath,
  dateFrom = "",
  dateTo = "",
  validationYears = [],
  purgeBars = 5,
  embargoBars = 5,
  labelHorizonBars = 3,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  const normalizedPurgeBars = Math.max(0, Math.trunc(toNumber(purgeBars, 5)))
  const normalizedEmbargoBars = Math.max(0, Math.trunc(toNumber(embargoBars, 5)))
  const normalizedLabelHorizonBars = Math.max(1, Math.trunc(toNumber(labelHorizonBars, 3)))
  const { dates, sourcePath } = await loadDecisionDates({ candidateEventsPath, calendarPath, dateFrom, dateTo })
  const observedYears = uniqueSorted(dates.map((dateKey) => String(yearOf(dateKey)))).map(Number)
  const requestedYears = parseYears(validationYears)
  const outerValidationYears = requestedYears.length > 0 ? requestedYears : observedYears.slice(1)
  const unknownYears = outerValidationYears.filter((year) => !observedYears.includes(year))
  if (unknownYears.length > 0) throw new Error(`validation years not present in split dates: ${unknownYears.join(",")}`)
  const outerFolds = outerValidationYears.map((year) =>
    buildFold({
      foldId: `outer_${year}`,
      dates,
      validationYear: year,
      purgeBars: normalizedPurgeBars,
      embargoBars: normalizedEmbargoBars,
      labelHorizonBars: normalizedLabelHorizonBars,
    }),
  )
  const foldsWithInner = outerFolds.map((fold) => ({
    ...fold,
    innerFolds: buildInnerFolds({
      outerFold: fold,
      dates,
      purgeBars: normalizedPurgeBars,
      embargoBars: normalizedEmbargoBars,
      labelHorizonBars: normalizedLabelHorizonBars,
    }),
  }))
  const failures = []
  for (const fold of foldsWithInner) {
    if (fold.trainDateCount < 1) failures.push(`${fold.foldId}:zero_train_dates`)
    if (fold.validationDateCount < 1) failures.push(`${fold.foldId}:zero_validation_dates`)
    if (fold.labelHorizonOverlap.overlappingTrainDecisionDateCount > 0) {
      failures.push(`${fold.foldId}:label_horizon_overlap:${fold.labelHorizonOverlap.overlappingTrainDecisionDateCount}`)
    }
    for (const innerFold of fold.innerFolds) {
      if (innerFold.labelHorizonOverlap.overlappingTrainDecisionDateCount > 0) {
        failures.push(`${innerFold.foldId}:label_horizon_overlap:${innerFold.labelHorizonOverlap.overlappingTrainDecisionDateCount}`)
      }
    }
  }
  const summary = {
    kind: "tp12_nested_split_plan_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    sourcePath,
    dateRange: { from: dates[0], to: dates.at(-1) },
    observedYears,
    validationYears: outerValidationYears,
    purgeBars: normalizedPurgeBars,
    embargoBars: normalizedEmbargoBars,
    labelHorizonBars: normalizedLabelHorizonBars,
    decisionDateCount: dates.length,
    outerFoldCount: foldsWithInner.length,
    outerFolds: foldsWithInner,
    failures,
  }
  await writeJson(outPath, summary)
  if (failures.length > 0) throw new Error(`tp12 nested split plan failed: ${failures.join("; ")}`)
  return summary
}
