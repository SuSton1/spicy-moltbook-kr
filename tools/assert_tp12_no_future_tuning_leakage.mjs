#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { toText, validDateKey } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const FAR_FUTURE = "9999-12-31"
const FORBIDDEN_RANGE_KEYS = new Set([
  "trainDateRange",
  "trainingDateRange",
  "tuneDateRange",
  "tuningDateRange",
  "selectionDateRange",
  "selectorDateRange",
  "fitDateRange",
  "rankerFitDateRange",
  "miningDateRange",
  "thresholdDateRange",
  "thresholdSelectionDateRange",
])

const parseList = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const dateRangeOf = (value) => {
  if (!isObject(value)) return null
  const from = toText(value.from ?? value.dateFrom ?? value.start ?? value.startDate)
  const to = toText(value.to ?? value.dateTo ?? value.end ?? value.endDate) || FAR_FUTURE
  if (!validDateKey(from) || !validDateKey(to)) return null
  if (from > to) throw new Error(`invalid date range: ${from}..${to}`)
  return { from, to }
}

const rangeTouchesFuture = ({ range, futureFrom }) => range.to >= futureFrom

const roleOf = ({ value, keyPath }) =>
  toText(value?.purpose ?? value?.use ?? value?.role ?? value?.kind ?? keyPath[keyPath.length - 1]).toLowerCase()

const keyPathText = (keyPath) => keyPath.join(".")

const scanValue = ({ value, keyPath = [], futureFrom, forbiddenUses, violations }) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue({ value: item, keyPath: [...keyPath, String(index)], futureFrom, forbiddenUses, violations }))
    return
  }
  if (!isObject(value)) return

  const directRange = dateRangeOf(value)
  const role = roleOf({ value, keyPath })
  const key = keyPath[keyPath.length - 1] ?? ""
  const keyIsForbiddenRange = FORBIDDEN_RANGE_KEYS.has(key)
  const usedForTuning = value.usedForTuning === true || value.usedForTraining === true || value.usedForSelection === true
  const roleForbidden = forbiddenUses.has(role)
  if (directRange && rangeTouchesFuture({ range: directRange, futureFrom }) && (keyIsForbiddenRange || usedForTuning || roleForbidden)) {
    violations.push({
      path: keyPathText(keyPath),
      role,
      range: directRange,
      reason: keyIsForbiddenRange ? "forbidden_future_date_range_key" : roleForbidden ? "forbidden_future_role" : "future_used_for_tuning",
    })
  }
  const nestedRange = dateRangeOf(value.dateRange ?? value.range)
  if (nestedRange && rangeTouchesFuture({ range: nestedRange, futureFrom }) && (usedForTuning || roleForbidden)) {
    violations.push({
      path: `${keyPathText(keyPath)}.${Object.prototype.hasOwnProperty.call(value, "dateRange") ? "dateRange" : "range"}`,
      role,
      range: nestedRange,
      reason: roleForbidden ? "forbidden_future_role" : "future_used_for_tuning",
    })
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    scanValue({ value: childValue, keyPath: [...keyPath, childKey], futureFrom, forbiddenUses, violations })
  }
}

export const assertTp12NoFutureTuningLeakage = async ({
  contractPath = "meta/tp12_locked_future_eval_protocol_contract.json",
  artifactPaths = [],
  outPath = "",
} = {}) => {
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract not found: ${contractPath}`)
  const futureFrom = toText(contract.protocol?.futureTuningForbiddenFrom ?? contract.lockedFutureDateRange?.from)
  if (!validDateKey(futureFrom)) throw new Error(`invalid future tuning cutoff: ${futureFrom || "missing"}`)
  const forbiddenUses = new Set((contract.forbiddenFutureUses ?? []).map((item) => toText(item).toLowerCase()).filter(Boolean))
  if (forbiddenUses.size < 1) throw new Error("contract forbiddenFutureUses is required")
  const resolvedArtifacts = artifactPaths.map((item) => toText(item)).filter(Boolean)
  if (resolvedArtifacts.length < 1) throw new Error("at least one artifact path is required")
  const artifactSummaries = []
  const violations = []
  for (const artifactPath of resolvedArtifacts) {
    const payload = await readJson(artifactPath, null)
    if (!payload) throw new Error(`artifact not found or not JSON: ${artifactPath}`)
    const before = violations.length
    scanValue({
      value: payload,
      keyPath: [path.basename(artifactPath)],
      futureFrom,
      forbiddenUses,
      violations,
    })
    artifactSummaries.push({
      artifactPath: path.resolve(artifactPath),
      violationCount: violations.length - before,
    })
  }
  const summary = {
    kind: "tp12_no_future_tuning_leakage_assertion_v1",
    generatedAt: new Date().toISOString(),
    status: violations.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    futureTuningForbiddenFrom: futureFrom,
    artifactSummaries,
    violationCount: violations.length,
    violations,
  }
  if (toText(outPath)) await writeJson(outPath, summary)
  if (violations.length > 0) {
    throw new Error(`tp12 future tuning leakage detected: ${violations.map((row) => row.path).join("; ")}`)
  }
  return summary
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = path.resolve(cwd, toText(getFlag(flags, "contract-path", "meta/tp12_locked_future_eval_protocol_contract.json")))
  const artifactPaths = [
    ...parseList(getFlag(flags, "artifact-paths", "")),
    ...parseList(getFlag(flags, "artifacts", "")),
    toText(getFlag(flags, "artifact", "")),
  ]
    .filter(Boolean)
    .map((item) => path.resolve(cwd, item))
  const outPath = toText(getFlag(flags, "out", "")) ? path.resolve(cwd, toText(getFlag(flags, "out", ""))) : ""
  const summary = await assertTp12NoFutureTuningLeakage({ contractPath, artifactPaths, outPath })
  console.log(JSON.stringify({ status: summary.status, violationCount: summary.violationCount, outPath: outPath || null }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
