import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { pathExists, readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))

const parseCases = (rawCases) =>
  String(rawCases ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbolRaw, dateRaw] = entry.split(":")
      const symbol = String(symbolRaw ?? "").trim()
      const recommendationDateKey = String(dateRaw ?? "").trim()
      if (!symbol || !recommendationDateKey) {
        throw new Error(`invalid --cases entry: ${entry}`)
      }
      return {
        symbol,
        recommendationDateKey,
      }
    })

const normalizeDateKey = (row) =>
  toText(row?.recommendationDateKey) ?? toText(row?.dateKey) ?? toText(row?.eventDate)

const buildCaseKey = ({ symbol, recommendationDateKey }) => `${recommendationDateKey}::${symbol}`

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const runDirRaw = String(getFlag(parsed.flags, "run-dir", "")).trim()
  const runId = String(getFlag(parsed.flags, "run-id", "")).trim()
  const cases = parseCases(getFlag(parsed.flags, "cases", ""))
  const outPath = toText(getFlag(parsed.flags, "out-path", ""))

  const runDir = runDirRaw
    ? path.resolve(runDirRaw)
    : runId
      ? path.resolve(process.cwd(), "artifacts", "runs", runId)
      : null
  if (!runDir || cases.length < 1) {
    throw new Error(
      "Usage: node tools/report_live_priority_symbol_rule_support.mjs --run-dir=<artifacts/runs/...> --cases=<SYMBOL:YYYY-MM-DD[,SYMBOL:YYYY-MM-DD...]> [--out-path=<json>]",
    )
  }

  const finalSummaryPath = path.join(runDir, "final_summary.json")
  const finalUnionPath = path.join(runDir, "final_union.jsonl")
  const lineManifestPath = path.join(runDir, "line_results_manifest.json")
  if (!pathExists(finalSummaryPath) || !pathExists(finalUnionPath) || !pathExists(lineManifestPath)) {
    throw new Error(`live priority run is missing required artifacts under ${runDir}`)
  }

  const [finalSummary, finalUnionRows, lineManifest] = await Promise.all([
    readJson(finalSummaryPath, null),
    readJsonl(finalUnionPath),
    readJson(lineManifestPath, null),
  ])
  const manifestLines = Array.isArray(lineManifest?.lines) ? lineManifest.lines : []
  const caseLookup = new Map(cases.map((entry) => [buildCaseKey(entry), entry]))

  const finalUnionByCase = new Map()
  for (const row of Array.isArray(finalUnionRows) ? finalUnionRows : []) {
    const key = buildCaseKey({
      symbol: String(row?.symbol ?? "").trim(),
      recommendationDateKey: String(row?.recommendationDateKey ?? "").trim(),
    })
    if (!caseLookup.has(key)) continue
    const bucket = finalUnionByCase.get(key) ?? []
    bucket.push({
      lineId: toText(row?.lineId),
      priority: Number(row?.priority ?? 0) || null,
      primaryRuleId: toText(row?.primaryRuleId),
      matchedRuleIds: uniqueSorted(row?.matchedRuleIds),
      supportingLines: Array.isArray(row?.supportingLines)
        ? row.supportingLines.map((entry) => ({
            lineId: toText(entry?.lineId),
            priority: Number(entry?.priority ?? 0) || null,
            primaryRuleId: toText(entry?.primaryRuleId),
          }))
        : [],
    })
    finalUnionByCase.set(key, bucket)
  }

  const lineReports = []
  for (const line of manifestLines) {
    const applyDir = path.dirname(String(line?.applySummaryPath ?? "").trim())
    const rawMatchesPath = path.join(applyDir, "matches.jsonl")
    const dedupedMatchesPath = String(line?.dedupedInputPath ?? "").trim()
    if (!pathExists(rawMatchesPath) || !pathExists(dedupedMatchesPath) || !pathExists(String(line?.catalogPath ?? "").trim())) {
      throw new Error(`line ${line?.lineId ?? "unknown"} is missing replay artifacts required for symbol rule support`)
    }
    const [rawMatches, dedupedMatches, catalog] = await Promise.all([
      readJsonl(rawMatchesPath),
      readJsonl(dedupedMatchesPath),
      loadPerfectPrototypeCatalog(String(line.catalogPath)),
    ])
    const exactRuleIds = new Set(
      (Array.isArray(catalog?.rules) ? catalog.rules : [])
        .filter((rule) => Number(rule?.precision ?? 0) >= 1)
        .map((rule) => String(rule?.ruleId ?? "").trim())
        .filter(Boolean),
    )

    const perCase = []
    for (const entry of cases) {
      const matchingRawRows = rawMatches.filter(
        (row) =>
          String(row?.symbol ?? "").trim() === entry.symbol &&
          normalizeDateKey(row) === entry.recommendationDateKey,
      )
      const matchingDedupedRows = dedupedMatches.filter(
        (row) =>
          String(row?.symbol ?? "").trim() === entry.symbol &&
          normalizeDateKey(row) === entry.recommendationDateKey,
      )
      const rawMatchedRuleIds = uniqueSorted(
        matchingRawRows.flatMap((row) => (Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : [])),
      )
      const dedupedMatchedRuleIds = uniqueSorted(
        matchingDedupedRows.flatMap((row) => (Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : [])),
      )
      const matchedTrain100ExactRuleIds = uniqueSorted(
        rawMatchedRuleIds.filter((ruleId) => exactRuleIds.has(ruleId)),
      )
      perCase.push({
        symbol: entry.symbol,
        recommendationDateKey: entry.recommendationDateKey,
        rawMatchCount: matchingRawRows.length,
        dedupedMatchCount: matchingDedupedRows.length,
        rawMatchedRuleIds,
        dedupedMatchedRuleIds,
        matchedTrain100ExactRuleIds,
        matchedTrain100ExactRuleCount: matchedTrain100ExactRuleIds.length,
        primaryRuleIds: uniqueSorted(matchingDedupedRows.map((row) => row?.primaryRuleId)),
      })
    }

    lineReports.push({
      lineId: toText(line?.lineId),
      priority: Number(line?.priority ?? 0) || null,
      lineRole: toText(line?.lineRole),
      selectionMode: toText(line?.selectionMode),
      discoveryUniverseId: toText(line?.discoveryUniverseId),
      lookbackTradingDays: Number(line?.lookbackTradingDays ?? 0) || null,
      catalogPath: toText(line?.catalogPath),
      catalogRuleCount: Array.isArray(catalog?.rules) ? catalog.rules.length : 0,
      exactRuleCount: exactRuleIds.size,
      cases: perCase,
    })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runDir,
    runId: toText(finalSummary?.runId) ?? toText(lineManifest?.runId),
    targetDate: toText(finalSummary?.targetDate),
    finalUnionCount: Number(finalSummary?.finalUnionCount ?? 0) || 0,
    priorityCounts:
      finalSummary?.priorityCounts && typeof finalSummary.priorityCounts === "object"
        ? { ...finalSummary.priorityCounts }
        : { priority1: 0, priority2: 0, priority3: 0 },
    cases: cases.map((entry) => {
      const key = buildCaseKey(entry)
      return {
        ...entry,
        finalUnionRows: finalUnionByCase.get(key) ?? [],
        lineSupport: lineReports.map((line) => ({
          lineId: line.lineId,
          priority: line.priority,
          lineRole: line.lineRole,
          support: line.cases.find(
            (candidate) =>
              candidate.symbol === entry.symbol &&
              candidate.recommendationDateKey === entry.recommendationDateKey,
          ),
        })),
      }
    }),
  }

  if (outPath) {
    await writeJson(path.resolve(outPath), report)
  } else {
    console.log(JSON.stringify(report, null, 2))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
