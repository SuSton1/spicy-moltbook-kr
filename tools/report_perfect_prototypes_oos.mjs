import path from "node:path"
import { pathToFileURL } from "node:url"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import {
  createJsonlWriter,
  ensureDir,
  pathExists,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
} from "../src/lib/io.mjs"
import {
  assertPerfectPrototypeParquetInput,
  iteratePerfectPrototypeDateGroupsFromInput,
  loadPerfectPrototypeRowsFromInput,
} from "../src/lib/perfect_prototype_parquet_io.mjs"
import { loadPerfectPrototypeCatalog, selectPerfectPrototypeRules } from "../src/lib/perfect_prototype_catalog.mjs"
import { createPerfectPrototypeMatchAccumulator } from "../src/lib/perfect_prototype_dedupe.mjs"
import { enrichPerfectPrototypeRowsWithContext } from "../src/lib/perfect_prototype_contextual_features.mjs"
import { enrichPerfectPrototypeRowsWithDecisionContext } from "../src/lib/perfect_prototype_decision_contextual_features.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  assertPerfectPrototypeDatasetContractCompatible,
  assertNoPrejumpLeakageRows,
  inferPerfectPrototypeDatasetContract,
  isPrejumpPredictiveSurface,
  normalizePerfectPrototypeDatasetContract,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import {
  normalizePerfectPrototypeRow,
  tokenizePerfectPrototypeRow,
} from "../src/lib/perfect_prototype_tokenizer.mjs"
import {
  computePerfectPrototypeGapStats,
  matchPerfectPrototypeRule,
  rankPerfectPrototypeRules,
} from "../src/lib/perfect_prototype_rule.mjs"
import {
  buildPerfectPrototypeRuleMatchIndex,
  selectPerfectPrototypeCandidateRules,
} from "../src/lib/perfect_prototype_rule_match_index.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

export const summarizePerfectPrototypeOosRuleStat = ({ stat, calendarDateKeys }) => {
  const gapStats = computePerfectPrototypeGapStats({
    dateKeys: stat?.oosHitDates,
    calendarDateKeys,
  })
  const matchedDateCount = uniqueSorted(stat?.oosMatchedDates).length
  const hitDateCount = uniqueSorted(stat?.oosHitDates).length
  return {
    ...(stat && typeof stat === "object" ? stat : {}),
    oosPrecision: Number(stat?.oosMatchCount ?? 0) > 0 ? Number(stat.oosHitCount ?? 0) / Number(stat.oosMatchCount ?? 0) : 0,
    oosMaxGapTradingDays: gapStats.maxGapTradingDays,
    oosFirstHitDate: gapStats.hitDates[0] ?? null,
    oosLastHitDate: gapStats.hitDates[gapStats.hitDates.length - 1] ?? null,
    oosHitDateCount: hitDateCount,
    oosMatchedDateCount: matchedDateCount,
  }
}

const readOptionalJson = async (filePath) => {
  if (!pathExists(filePath)) return null
  return readJson(filePath, null)
}

const resolveDatasetContractPayload = (payload) => {
  const candidate =
    payload?.datasetContract ??
    payload?.summary?.datasetContract ??
    payload?.manifest?.datasetContract ??
    payload?.manifest?.summary?.datasetContract ??
    null
  if (!candidate || typeof candidate !== "object") return null
  return normalizePerfectPrototypeDatasetContract(candidate)
}

const resolveCatalogDatasetContract = (catalog) => {
  const candidate =
    catalog?.metadata?.datasetContract ??
    catalog?.metadata?.sourceCatalogMetadata?.datasetContract ??
    null
  if (!candidate || typeof candidate !== "object") return null
  return normalizePerfectPrototypeDatasetContract(candidate)
}

const resolveCoveragePeriodFromSummary = (payload) => {
  const summary = payload?.summary ?? payload?.manifest?.summary ?? payload ?? null
  const requestedPeriod = summary?.requestedPeriod ?? summary?.period ?? null
  const outputCoverage = summary?.outputCoverage ?? null
  const from = String(requestedPeriod?.from ?? requestedPeriod?.dateFrom ?? "").trim() || null
  const to = String(requestedPeriod?.to ?? requestedPeriod?.dateTo ?? "").trim() || null
  if (!from || !to) return null
  return {
    from,
    to,
    outputCoverage:
      outputCoverage && typeof outputCoverage === "object"
        ? {
            from: String(outputCoverage?.from ?? "").trim() || null,
            to: String(outputCoverage?.to ?? "").trim() || null,
            count: Number(outputCoverage?.count ?? 0) || 0,
          }
        : null,
    truncatedByLimitRows: summary?.truncatedByLimitRows === true,
    coverageComplete: summary?.coverageComplete !== false,
  }
}

const resolveInputCoveragePeriod = async (inputPath) => {
  const inputDir = path.dirname(inputPath)
  const inputBase = path.basename(inputPath)
  const stepSummaryCandidates = []
  if (inputBase === "templates_lite.jsonl" || inputBase === "templates.jsonl") {
    stepSummaryCandidates.push(
      path.join(path.dirname(inputDir), "step-a", "step_a_summary.json"),
      path.join(inputDir, "step_b_summary.json"),
    )
  }
  if (
    inputBase === "daily_pack.jsonl" ||
    inputBase === "prejump_pack.jsonl" ||
    inputBase === "prejump_pack.parquet"
  ) {
    stepSummaryCandidates.push(
      path.join(inputDir, "summary.json"),
      path.join(inputDir, "manifest.json"),
    )
  }
  stepSummaryCandidates.push(
    path.join(inputDir, "summary.json"),
    path.join(inputDir, "manifest.json"),
  )

  for (const candidatePath of uniqueSorted(stepSummaryCandidates)) {
    const payload = await readOptionalJson(candidatePath)
    const datasetContract = resolveDatasetContractPayload(payload)
    const period = resolveCoveragePeriodFromSummary(payload)
    if (period || datasetContract) {
      return {
        ...(period ?? {}),
        datasetContract,
        sourcePath: candidatePath,
      }
    }
  }
  return null
}

const resolveActualCoverageFromRows = (rows) => {
  const dateKeys = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey =
      String(
        row?.dateKey ??
          row?.decisionDateKey ??
          row?.eventDateKey ??
          row?.targetDateKey ??
          row?.asOfDateKey ??
          "",
      ).trim() || null
    if (dateKey) dateKeys.push(dateKey)
  }
  if (dateKeys.length < 1) return null
  dateKeys.sort((left, right) => String(left).localeCompare(String(right)))
  return {
    from: dateKeys[0],
    to: dateKeys[dateKeys.length - 1],
    count: dateKeys.length,
  }
}

const resolveActualCoverageFromDateKeys = (dateKeys) => {
  const values = (Array.isArray(dateKeys) ? dateKeys : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => String(left).localeCompare(String(right)))
  if (values.length < 1) return null
  return {
    from: values[0],
    to: values[values.length - 1],
    count: values.length,
  }
}

const assertRequestedCoverage = async ({ inputPath, startDate, endDate }) => {
  if (!startDate && !endDate) return null
  const coverage = await resolveInputCoveragePeriod(inputPath)
  if (!coverage) {
    throw new Error(
      [
        "Unable to verify OOS input coverage period.",
        `input=${inputPath}`,
        "Expected a companion summary/manifest with period.from/to.",
      ].join(" "),
    )
  }
  if (coverage.truncatedByLimitRows === true || coverage.coverageComplete === false) {
    throw new Error(
      [
        "OOS input coverage cannot be trusted because the source pack was truncated.",
        `input=${inputPath}`,
        `coverageSource=${coverage.sourcePath}`,
      ].join(" "),
    )
  }
  if (startDate && coverage.from > startDate) {
    throw new Error(
      `OOS input coverage starts too late: requestedStart=${startDate} actualStart=${coverage.from} source=${coverage.sourcePath}`,
    )
  }
  if (endDate && coverage.to < endDate) {
    throw new Error(
      `OOS input coverage ends too early: requestedEnd=${endDate} actualEnd=${coverage.to} source=${coverage.sourcePath}`,
    )
  }
  return coverage
}

const assertUsableCoverage = ({ rows = null, usableCoverage = null, coverage, inputPath }) => {
  const expected = coverage?.outputCoverage ?? null
  if (!expected?.from || !expected?.to) return null
  const resolvedUsableCoverage = usableCoverage ?? resolveActualCoverageFromRows(rows)
  if (!resolvedUsableCoverage) {
    throw new Error(
      [
        "OOS usable row coverage cannot be verified because no normalized rows survived.",
        `input=${inputPath}`,
        `expectedFrom=${expected.from}`,
        `expectedTo=${expected.to}`,
      ].join(" "),
    )
  }
  if (resolvedUsableCoverage.from > expected.from) {
    throw new Error(
      `OOS usable row coverage starts too late: expectedStart=${expected.from} actualStart=${resolvedUsableCoverage.from} input=${inputPath}`,
    )
  }
  if (resolvedUsableCoverage.to < expected.to) {
    throw new Error(
      `OOS usable row coverage ends too early: expectedEnd=${expected.to} actualEnd=${resolvedUsableCoverage.to} input=${inputPath}`,
    )
  }
  return resolvedUsableCoverage
}

const enrichRowsForCatalogSurface = ({ rows, catalog }) => {
  const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  if (isPrejumpPredictiveSurface(surface)) {
    assertNoPrejumpLeakageRows(rows)
    return enrichPerfectPrototypeRowsWithDecisionContext(rows, {
      referenceRows: rows,
      preserveExisting: true,
    })
  }
  return enrichPerfectPrototypeRowsWithContext(rows, {
    referenceRows: rows,
    replaceExistingContextualTokens: true,
  })
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "report_perfect_prototypes_oos",
  })
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!inputPath || !catalogPath || !outDir) {
    throw new Error(
      "Usage: node tools/report_perfect_prototypes_oos.mjs --input=<templates_lite.jsonl|prejump_pack.parquet> --catalog=<catalog.json> --out-dir=<dir> [--selection-mode=union_all|champion_only|top2_per_day_union] [--start=2025-01-01] [--end=2026-02-19] --expected-catalog-sha256=<sha256> --expected-rule-ids-sha256=<sha256>",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "catalog", filePath: catalogPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "report_perfect_prototypes_oos",
  })
  const expectedCatalogSha256 = String(getFlag(parsed.flags, "expected-catalog-sha256", "")).trim() || null
  const expectedRuleIdsSha256 = String(getFlag(parsed.flags, "expected-rule-ids-sha256", "")).trim() || null
  if (!expectedCatalogSha256 || !expectedRuleIdsSha256) {
    throw new Error(
      [
        "Frozen catalog verification requires --expected-catalog-sha256 and --expected-rule-ids-sha256.",
        `catalog=${catalogPath}`,
        "Read the sibling manifest.json from the frozen catalog directory and pass both hashes explicitly.",
      ].join(" "),
    )
  }
  const catalog = await loadPerfectPrototypeCatalog(catalogPath, {
    expectedCatalogSha256,
    expectedRuleIdsSha256,
    requireFrozen: true,
  })
  const catalogDatasetContract = resolveCatalogDatasetContract(catalog)
  const startDate = String(getFlag(parsed.flags, "start", "2025-01-01")).trim() || null
  const endDate = String(getFlag(parsed.flags, "end", "")).trim() || null
  const coverage = await assertRequestedCoverage({
    inputPath,
    startDate,
    endDate,
  })
  let inputDatasetContract =
    coverage?.datasetContract ??
    null
  if (catalogDatasetContract && inputDatasetContract) {
    assertPerfectPrototypeDatasetContractCompatible({
      expected: catalogDatasetContract,
      actual: inputDatasetContract,
      expectedLabel: "catalog",
      actualLabel: "input",
    })
  }
  const selectionMode = String(getFlag(parsed.flags, "selection-mode", "union_all")).trim() || "union_all"
  const selectionMaxSymbolsPerDay = selectionMode === "top2_per_day_union" ? 2 : null
  const rules = rankPerfectPrototypeRules(
    selectPerfectPrototypeRules(catalog, selectionMode),
  )
  const ruleMatchIndex = buildPerfectPrototypeRuleMatchIndex({ rules })
  const ruleStats = new Map(
    rules.map((rule) => [
      rule.ruleId,
      {
        ruleId: rule.ruleId,
        tokens: rule.tokens,
        oosMatchCount: 0,
        oosHitCount: 0,
        oosNegativeCount: 0,
        oosMatchedDates: [],
        oosHitDates: [],
      },
    ]),
  )
  await ensureDir(outDir)
  const matchesWriter = await createJsonlWriter(path.join(outDir, "oos_matches.jsonl"))
  const matchAccumulator = createPerfectPrototypeMatchAccumulator({
    rules,
    selectionMode,
    selectionMaxSymbolsPerDay,
  })
  let rawMatchCount = 0
  const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  const predictive = isPrejumpPredictiveSurface(surface)
  if (predictive) {
    assertPerfectPrototypeParquetInput({
      inputPath,
      label: "predictive OOS input",
    })
  }
  let sourceRows = 0
  let ruleCandidateChecks = 0
  const usableDateKeys = []
  const calendarDateKeySet = new Set()

  const processRows = async (rows) => {
    for (const row of rows) {
      calendarDateKeySet.add(row.dateKey)
      usableDateKeys.push(row.dateKey)
      const tokens = tokenizePerfectPrototypeRow(row, catalog?.tokenizerSpec)
      const tokenSet = new Set(tokens)
      const candidateRules = selectPerfectPrototypeCandidateRules({
        tokenSet,
        matchIndex: ruleMatchIndex,
      })
      ruleCandidateChecks += candidateRules.length
      const matchedRules = candidateRules
        .filter((rule) => matchPerfectPrototypeRule(tokenSet, rule))
        .sort((left, right) => Number(left?.rank ?? Number.MAX_SAFE_INTEGER) - Number(right?.rank ?? Number.MAX_SAFE_INTEGER))
      if (matchedRules.length < 1) continue
      for (const rule of matchedRules) {
        const stat = ruleStats.get(rule.ruleId)
        stat.oosMatchCount += 1
        stat.oosMatchedDates.push(row.dateKey)
        if (row.outcomeHitTarget === true) {
          stat.oosHitCount += 1
          stat.oosHitDates.push(row.dateKey)
        } else {
          stat.oosNegativeCount += 1
        }
      }
      const matchRow = {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        dateKey: row.dateKey,
        symbol: row.symbol,
        outcomeHitTarget: row.outcomeHitTarget,
        matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
        matchedRuleCount: matchedRules.length,
        primaryRuleId: matchedRules[0]?.ruleId ?? null,
      }
      await matchesWriter.writeRow(matchRow)
      matchAccumulator.consume(matchRow)
      rawMatchCount += 1
    }
  }

  if (predictive) {
    await iteratePerfectPrototypeDateGroupsFromInput({
      cwd,
      inputPath,
      requireParquet: true,
      inputLabel: "predictive OOS input",
      onGroup: async ({ rows: groupRows }) => {
        const contextualizedRows = enrichRowsForCatalogSurface({
          rows: groupRows,
          catalog,
        })
        const normalizedRows = contextualizedRows
          .map((row) => normalizePerfectPrototypeRow(row, catalog?.tokenizerSpec?.options))
          .filter((row) => {
            if (!row.dateKey || typeof row.outcomeHitTarget !== "boolean") return false
            if (startDate && row.dateKey < startDate) return false
            if (endDate && row.dateKey > endDate) return false
            return true
          })
        sourceRows += normalizedRows.length
        await processRows(normalizedRows)
      },
    })
    assertUsableCoverage({
      usableCoverage: resolveActualCoverageFromDateKeys(usableDateKeys),
      coverage,
      inputPath,
    })
  } else {
    const inputRows = await loadPerfectPrototypeRowsFromInput({
      cwd,
      inputPath,
      requireParquet: predictive,
      inputLabel: predictive ? "predictive OOS input" : "input",
    })
    inputDatasetContract =
      inputDatasetContract ??
      normalizePerfectPrototypeDatasetContract(inferPerfectPrototypeDatasetContract(inputRows))
    if (catalogDatasetContract && inputDatasetContract) {
      assertPerfectPrototypeDatasetContractCompatible({
        expected: catalogDatasetContract,
        actual: inputDatasetContract,
        expectedLabel: "catalog",
        actualLabel: "input",
      })
    }
    sourceRows = inputRows.length
    const contextualizedRows = enrichRowsForCatalogSurface({
      rows: inputRows,
      catalog,
    })
    const rows = contextualizedRows
      .map((row) => normalizePerfectPrototypeRow(row, catalog?.tokenizerSpec?.options))
      .filter((row) => {
        if (!row.dateKey || typeof row.outcomeHitTarget !== "boolean") return false
        if (startDate && row.dateKey < startDate) return false
        if (endDate && row.dateKey > endDate) return false
        return true
      })
    assertUsableCoverage({
      rows,
      coverage,
      inputPath,
    })
    await processRows(rows)
  }
  await matchesWriter.close()

  const calendarDateKeys = uniqueSorted(Array.from(calendarDateKeySet))

  const {
    dedupedMatches,
    symbolDayDedupedMatches,
    dayCapDroppedRows,
    topOverflowDates,
    overlapRows,
  } = matchAccumulator.finalize()
  const rankedRuleStats = Array.from(ruleStats.values())
    .map((stat) => summarizePerfectPrototypeOosRuleStat({ stat, calendarDateKeys }))
    .sort((left, right) => {
      if (right.oosPrecision !== left.oosPrecision) return right.oosPrecision - left.oosPrecision
      if (right.oosHitCount !== left.oosHitCount) return right.oosHitCount - left.oosHitCount
      return String(left.ruleId).localeCompare(String(right.ruleId))
    })

  await writeJsonl(path.join(outDir, "oos_deduped_symbols.jsonl"), dedupedMatches)
  await writeJson(path.join(outDir, "oos_rule_report.json"), rankedRuleStats)
  await writeJson(path.join(outDir, "oos_summary.json"), {
    inputPath,
    catalogPath: catalog.path ?? catalogPath,
    catalogContentSha256: catalog?.freeze?.catalogContentSha256 ?? null,
    ruleIdsSha256: catalog?.freeze?.ruleIdsSha256 ?? null,
    catalogDatasetContract,
    inputDatasetContract,
    inputDatasetContractSourcePath: coverage?.sourcePath ?? null,
    selectionMode,
    startDate,
    endDate,
    inputCoverage: coverage,
    sourceRows,
    rawMatchedRows: rawMatchCount,
    rawMatches: rawMatchCount,
    ruleCandidateChecks,
    tokenIdCandidateChecks: ruleCandidateChecks,
    selectionMaxSymbolsPerDay,
    symbolDayDedupedRows: symbolDayDedupedMatches.length,
    dayCappedSelectedRows: dedupedMatches.length,
    dayCapDroppedRows: dayCapDroppedRows.length,
    topOverflowDates: topOverflowDates.slice(0, 20),
    dedupedMatchedRows: dedupedMatches.length,
    dedupedMatches: dedupedMatches.length,
    overlapCount: overlapRows.length,
    uniqueMatchedSymbols: uniqueSorted(dedupedMatches.map((row) => row.symbol)).length,
    uniqueMatchedDates: uniqueSorted(dedupedMatches.map((row) => row.dateKey)).length,
  })
}

const isDirectExecution = (() => {
  const entryPath = process.argv[1]
  if (!entryPath) return false
  return import.meta.url === pathToFileURL(entryPath).href
})()

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
