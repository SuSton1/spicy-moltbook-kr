import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import {
  createJsonlWriter,
  ensureDir,
  iterateJsonl,
  pathExists,
  readJson,
  writeJson,
  writeJsonl,
} from "../src/lib/io.mjs"
import { buildRecommendationCloseRetLookupForMatchTargets } from "../src/lib/perfect_prototype_apply_close_ret_lookup.mjs"
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
  assertPerfectPrototypeDatasetContractCompatible,
  assertNoPrejumpLeakageRows,
  inferPerfectPrototypeDatasetContract,
  isPrejumpPredictiveSurface,
  normalizePerfectPrototypeDatasetContract,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import {
  assertPerfectPrototypeRecommendationCloseRetSidecar,
  loadPerfectPrototypeRecommendationCloseRetLookupForDate,
  resolvePerfectPrototypeRecommendationCloseRetSidecarPath,
} from "../src/lib/perfect_prototype_recommendation_close_ret_sidecar.mjs"
import {
  buildPerfectPrototypeRuleMatchIndex,
  selectPerfectPrototypeCandidateRules,
} from "../src/lib/perfect_prototype_rule_match_index.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  normalizePerfectPrototypeRow,
  tokenizePerfectPrototypeRow,
} from "../src/lib/perfect_prototype_tokenizer.mjs"
import { matchPerfectPrototypeRule, rankPerfectPrototypeRules } from "../src/lib/perfect_prototype_rule.mjs"

const normalizeRowsByDate = (rows, { startDate, endDate }) =>
  (Array.isArray(rows) ? rows : []).filter((row) => {
    const dateKey = String(row?.decisionDateKey ?? row?.eventDate ?? "").trim()
    if (!dateKey) return false
    if (startDate && dateKey < startDate) return false
    if (endDate && dateKey > endDate) return false
    return true
  })

const isRequestedDateKey = (dateKey, { startDate = null, endDate = null } = {}) => {
  const normalizedDateKey = String(dateKey ?? "").trim()
  if (!normalizedDateKey) return false
  if (startDate && normalizedDateKey < startDate) return false
  if (endDate && normalizedDateKey > endDate) return false
  return true
}

const resolveOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const resolveApplyDateKey = (row) =>
  String(row?.dateKey ?? row?.recommendationDateKey ?? row?.eventDate ?? "").trim() || null

const buildApplySelectionSummary = ({
  inputPath,
  catalog,
  catalogPath,
  catalogDatasetContract,
  inputDatasetContract,
  inputDatasetContractSourcePath,
  selectionMode,
  recommendationDateCloseRetFilter,
  sourceRows,
  preFilterRawMatches,
  rawMatches,
  selectionMaxSymbolsPerDay,
  symbolDayDedupedMatches,
  dedupedMatches,
  dayCapDroppedRows,
  topOverflowDates,
  overlapRows,
  ruleCandidateChecks,
}) => {
  const dedupedMatchedPositiveRows = (Array.isArray(dedupedMatches) ? dedupedMatches : []).filter(
    (row) => resolveOutcomeHitTarget(row) === true,
  ).length
  const uniqueMatchedDates = new Set(
    (Array.isArray(dedupedMatches) ? dedupedMatches : [])
      .map((row) => resolveApplyDateKey(row))
      .filter(Boolean),
  ).size
  const uniqueMatchedSymbols = new Set(
    (Array.isArray(dedupedMatches) ? dedupedMatches : [])
      .map((row) => String(row?.symbol ?? "").trim())
      .filter(Boolean),
  ).size
  return {
    inputPath,
    catalogPath: catalog.path ?? catalogPath,
    catalogContentSha256: catalog?.freeze?.catalogContentSha256 ?? null,
    ruleIdsSha256: catalog?.freeze?.ruleIdsSha256 ?? null,
    catalogDatasetContract,
    inputDatasetContract,
    inputDatasetContractSourcePath,
    selectionMode,
    recommendationDateCloseRetFilter,
    sourceRows,
    preFilterRawMatches,
    rawMatchedRows: rawMatches,
    rawMatches,
    selectionMaxSymbolsPerDay,
    symbolDayDedupedRows: symbolDayDedupedMatches.length,
    dayCappedSelectedRows: dedupedMatches.length,
    dayCapDroppedRows: dayCapDroppedRows.length,
    topOverflowDates: topOverflowDates.slice(0, 20),
    dedupedMatchedRows: dedupedMatches.length,
    dedupedMatches: dedupedMatches.length,
    dedupedMatchedPositiveRows,
    lineLevelHitCount: dedupedMatchedPositiveRows,
    lineLevelHitRate: dedupedMatches.length > 0 ? dedupedMatchedPositiveRows / dedupedMatches.length : 0,
    uniqueMatchedDates,
    uniqueMatchedSymbols,
    overlapCount: overlapRows.length,
    ruleCandidateChecks,
    tokenIdCandidateChecks: ruleCandidateChecks,
  }
}

const parseOptionalNumberFlag = (parsed, name) => {
  const raw = String(getFlag(parsed.flags, name, "")).trim()
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid --${name}: ${raw}`)
  }
  return value
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

const resolveInputDatasetContractFromArtifacts = async (inputPath) => {
  const inputDir = path.dirname(inputPath)
  const candidates = [
    path.join(inputDir, "summary.json"),
    path.join(inputDir, "manifest.json"),
  ]
  for (const candidatePath of candidates) {
    if (!pathExists(candidatePath)) continue
    const payload = await readJson(candidatePath, null)
    const datasetContract = resolveDatasetContractPayload(payload)
    if (!datasetContract) continue
    return {
      datasetContract,
      sourcePath: candidatePath,
    }
  }
  return {
    datasetContract: null,
    sourcePath: null,
  }
}

const resolveCatalogDatasetContract = (catalog) => {
  const candidate =
    catalog?.metadata?.datasetContract ??
    catalog?.metadata?.sourceCatalogMetadata?.datasetContract ??
    null
  if (!candidate || typeof candidate !== "object") return null
  return normalizePerfectPrototypeDatasetContract(candidate)
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "apply_perfect_prototypes",
  })
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const closeRetFilterGte = parseOptionalNumberFlag(parsed, "exclude-recommendation-close-ret-pct-gte")
  const candlePathRaw = String(getFlag(parsed.flags, "candle-path", "")).trim()
  const candlePath =
    closeRetFilterGte == null || !candlePathRaw ? null : path.resolve(candlePathRaw)
  const recommendationCloseRetSidecarPath = resolvePerfectPrototypeRecommendationCloseRetSidecarPath({
    cwd,
    sidecarPath:
      closeRetFilterGte == null
        ? null
        : String(getFlag(parsed.flags, "recommendation-close-ret-sidecar", "")).trim() || null,
  })
  if (!inputPath || !catalogPath || !outDir) {
    throw new Error(
      "Usage: node tools/apply_perfect_prototypes.mjs --input=<feature_pack.jsonl|feature_pack.parquet> --catalog=<catalog.json> --out-dir=<dir> [--selection-mode=union_all|champion_only|top2_per_day_union] --expected-catalog-sha256=<sha256> --expected-rule-ids-sha256=<sha256> [--exclude-recommendation-close-ret-pct-gte=<pct> (--recommendation-close-ret-sidecar=<recommendation_close_ret_dir>|--candle-path=<candle_daily.jsonl>)]",
    )
  }
  const expectedCatalogSha256 = String(getFlag(parsed.flags, "expected-catalog-sha256", "")).trim() || null
  const expectedRuleIdsSha256 = String(getFlag(parsed.flags, "expected-rule-ids-sha256", "")).trim() || null
  const selectionMode = String(getFlag(parsed.flags, "selection-mode", "union_all")).trim() || "union_all"
  const selectionMaxSymbolsPerDay = selectionMode === "top2_per_day_union" ? 2 : null
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
  const inputDatasetContractFromArtifacts = await resolveInputDatasetContractFromArtifacts(inputPath)
  const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  const predictive = isPrejumpPredictiveSurface(surface)
  if (closeRetFilterGte != null && !predictive && !candlePath) {
    throw new Error(
      "--exclude-recommendation-close-ret-pct-gte requires --candle-path=<candle_daily.jsonl> for non-predictive apply",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "catalog", filePath: catalog.path ?? catalogPath },
      { label: "outDir", filePath: outDir },
      ...(candlePath ? [{ label: "candlePath", filePath: candlePath }] : []),
      ...(closeRetFilterGte != null && predictive
        ? [{ label: "recommendationCloseRetSidecar", filePath: recommendationCloseRetSidecarPath }]
        : []),
    ],
    policy: serverPolicy,
    toolName: "apply_perfect_prototypes",
  })
  const rules = rankPerfectPrototypeRules(
    selectPerfectPrototypeRules(catalog, selectionMode),
  )
  const startDate = String(getFlag(parsed.flags, "start", "")).trim() || null
  const endDate = String(getFlag(parsed.flags, "end", "")).trim() || null
  const ruleMatchIndex = buildPerfectPrototypeRuleMatchIndex({ rules })
  let validatedRecommendationCloseRetSidecar = null
  if (predictive) {
    assertPerfectPrototypeParquetInput({
      inputPath,
      label: "predictive apply input",
    })
    if (catalogDatasetContract && inputDatasetContract) {
      assertPerfectPrototypeDatasetContractCompatible({
        expected: catalogDatasetContract,
        actual: inputDatasetContract,
        expectedLabel: "catalog",
        actualLabel: "input",
      })
    }
    if (closeRetFilterGte != null) {
      validatedRecommendationCloseRetSidecar = await assertPerfectPrototypeRecommendationCloseRetSidecar({
        sidecarPath: recommendationCloseRetSidecarPath,
        candlePath,
      })
    }
  }
  await ensureDir(outDir)
  const targetDatesBySymbol = new Map()
  let sourceRows = 0
  let preFilterRawMatches = 0
  let ruleCandidateChecks = 0
  let inputDatasetContract = inputDatasetContractFromArtifacts.datasetContract ?? null
  const processRows = async ({
    rawRows,
    onMatchRow,
    recommendationCloseRetBySymbol = null,
    missingCloseRetLabel = null,
  }) => {
    const contextualizedRows = enrichRowsForCatalogSurface({
      rows: rawRows,
      catalog,
    })
    for (const rawRow of contextualizedRows) {
      const row = normalizePerfectPrototypeRow(rawRow, catalog?.tokenizerSpec?.options)
      if (!row?.dateKey) continue
      if (startDate && row.dateKey < startDate) continue
      if (endDate && row.dateKey > endDate) continue
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
      const matchedRuleIds = matchedRules.map((rule) => rule.ruleId)
      if (matchedRuleIds.length < 1) continue
      const normalizedName = String(rawRow?.name ?? rawRow?.symbolName ?? row?.raw?.name ?? "").trim()
      const entryDateKey = String(row?.eventOutcome?.entryDateKey ?? "").trim() || null
      const exitDateKey = String(row?.eventOutcome?.exitDateKey ?? "").trim() || null
      const matchRow = {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        dateKey: row.dateKey,
        recommendationDateKey: row.dateKey,
        symbol: row.symbol,
        name: normalizedName || null,
        outcomeHitTarget: row.outcomeHitTarget,
        matchedRuleIds,
        matchedRuleCount: matchedRuleIds.length,
        primaryRuleId: matchedRuleIds[0] ?? null,
        asOfDateKey: row.asOfDateKey || null,
        entryDateKey,
        exitDateKey,
        recommendationDateCloseRetPct: null,
      }
      if (recommendationCloseRetBySymbol) {
        const recommendationCloseRetPct = recommendationCloseRetBySymbol.get(matchRow.symbol)
        if (!Number.isFinite(recommendationCloseRetPct)) {
          throw new Error(
            `Missing recommendation-date close return lookup for ${matchRow.symbol} ${matchRow.dateKey} from ${missingCloseRetLabel}`,
          )
        }
        matchRow.recommendationDateCloseRetPct = Number(recommendationCloseRetPct.toFixed(6))
      }
      await onMatchRow(matchRow)
    }
  }

  const runPredictivePass = async ({ countSourceRows, onMatchRow }) => {
    await iteratePerfectPrototypeDateGroupsFromInput({
      cwd,
      inputPath,
      requireParquet: true,
      inputLabel: "predictive apply input",
      onGroup: async ({ dateKey, rows }) => {
        if (!isRequestedDateKey(dateKey, { startDate, endDate })) return
        if (countSourceRows) sourceRows += rows.length
        await processRows({
          rawRows: rows,
          onMatchRow,
        })
      },
    })
  }

  const runLegacyPass = async ({ countSourceRows, onMatchRow }) => {
    const rawRows = normalizeRowsByDate(await loadPerfectPrototypeRowsFromInput({ cwd, inputPath }), {
      startDate,
      endDate,
    })
    inputDatasetContract =
      inputDatasetContract ??
      normalizePerfectPrototypeDatasetContract(inferPerfectPrototypeDatasetContract(rawRows))
    if (catalogDatasetContract && inputDatasetContract) {
      assertPerfectPrototypeDatasetContractCompatible({
        expected: catalogDatasetContract,
        actual: inputDatasetContract,
        expectedLabel: "catalog",
        actualLabel: "input",
      })
    }
    if (countSourceRows) sourceRows += rawRows.length
    await processRows({
      rawRows,
      onMatchRow,
    })
  }

  const runInputPass = async ({ countSourceRows = false, onMatchRow }) => {
    if (predictive) {
      await runPredictivePass({ countSourceRows, onMatchRow })
      return
    }
    await runLegacyPass({ countSourceRows, onMatchRow })
  }

  if (closeRetFilterGte == null) {
    const matchesWriter = await createJsonlWriter(path.join(outDir, "matches.jsonl"))
    const matchAccumulator = createPerfectPrototypeMatchAccumulator({
      rules,
      selectionMode,
      selectionMaxSymbolsPerDay,
    })
    let rawMatches = 0
    await runInputPass({
      countSourceRows: true,
      onMatchRow: async (matchRow) => {
        preFilterRawMatches += 1
        rawMatches += 1
        await matchesWriter.writeRow(matchRow)
        matchAccumulator.consume(matchRow)
      },
    })
    await matchesWriter.close()
    const {
      dedupedMatches,
      symbolDayDedupedMatches,
      dayCapDroppedRows,
      topOverflowDates,
      overlapRows,
    } = matchAccumulator.finalize()
    await writeJsonl(path.join(outDir, "deduped_symbols.jsonl"), dedupedMatches)
    await writeJson(path.join(outDir, "overlap.json"), {
      overlapRows,
      overlapCount: overlapRows.length,
    })
    await writeJson(
      path.join(outDir, "summary.json"),
      buildApplySelectionSummary({
        inputPath,
        catalog,
        catalogPath,
        catalogDatasetContract,
        inputDatasetContract,
        inputDatasetContractSourcePath: inputDatasetContractFromArtifacts.sourcePath,
        selectionMode,
        recommendationDateCloseRetFilter: null,
        sourceRows,
        preFilterRawMatches,
        rawMatches,
        selectionMaxSymbolsPerDay,
        symbolDayDedupedMatches,
        dedupedMatches,
        dayCapDroppedRows,
        topOverflowDates,
        overlapRows,
        ruleCandidateChecks,
      }),
    )
    return
  }

  if (predictive) {
    const filteredMatchesWriter = await createJsonlWriter(path.join(outDir, "matches.jsonl"))
    const excludedWriter = await createJsonlWriter(
      path.join(outDir, "excluded_matches_recommendation_close_ret_gte.jsonl"),
    )
    const matchAccumulator = createPerfectPrototypeMatchAccumulator({
      rules,
      selectionMode,
      selectionMaxSymbolsPerDay,
    })
    let rawMatches = 0
    let removedRawMatches = 0
    let removedHitMatches = 0
    let removedNegativeMatches = 0
    let sidecarLookupMs = 0
    let sidecarPartitionLoads = 0
    await iteratePerfectPrototypeDateGroupsFromInput({
      cwd,
      inputPath,
      requireParquet: true,
      inputLabel: "predictive apply input",
      onGroup: async ({ dateKey, rows }) => {
        if (!isRequestedDateKey(dateKey, { startDate, endDate })) return
        sourceRows += rows.length
        const sidecarLookupStartedAt = Date.now()
        const recommendationCloseRetBySymbol =
          await loadPerfectPrototypeRecommendationCloseRetLookupForDate({
            cwd,
            sidecarPath: recommendationCloseRetSidecarPath,
            dateKey,
            manifest: validatedRecommendationCloseRetSidecar?.manifest ?? null,
          })
        sidecarLookupMs += Date.now() - sidecarLookupStartedAt
        sidecarPartitionLoads += 1
        await processRows({
          rawRows: rows,
          recommendationCloseRetBySymbol,
          missingCloseRetLabel: recommendationCloseRetSidecarPath,
          onMatchRow: async (row) => {
            preFilterRawMatches += 1
            if (Number(row.recommendationDateCloseRetPct) >= closeRetFilterGte) {
              removedRawMatches += 1
              if (row?.outcomeHitTarget === true) removedHitMatches += 1
              if (row?.outcomeHitTarget === false) removedNegativeMatches += 1
              await excludedWriter.writeRow(row)
              return
            }
            await filteredMatchesWriter.writeRow(row)
            matchAccumulator.consume(row)
            rawMatches += 1
          },
        })
      },
    })

    await filteredMatchesWriter.close()
    await excludedWriter.close()
    const {
      dedupedMatches,
      symbolDayDedupedMatches,
      dayCapDroppedRows,
      topOverflowDates,
      overlapRows,
    } = matchAccumulator.finalize()
    await writeJsonl(path.join(outDir, "deduped_symbols.jsonl"), dedupedMatches)
    await writeJson(path.join(outDir, "overlap.json"), {
      overlapRows,
      overlapCount: overlapRows.length,
    })
    await writeJson(
      path.join(outDir, "summary.json"),
      buildApplySelectionSummary({
        inputPath,
        catalog,
        catalogPath,
        catalogDatasetContract,
        inputDatasetContract,
        inputDatasetContractSourcePath: inputDatasetContractFromArtifacts.sourcePath,
        selectionMode,
        recommendationDateCloseRetFilter: {
          gtePct: closeRetFilterGte,
          sidecarPath: recommendationCloseRetSidecarPath,
          removedRawMatches,
          removedHitMatches,
          removedNegativeMatches,
          sidecarLookupMs,
          sidecarPartitionLoads,
          mode: "single_pass_predictive_partitioned_sidecar_lookup",
        },
        sourceRows,
        preFilterRawMatches,
        rawMatches,
        selectionMaxSymbolsPerDay,
        symbolDayDedupedMatches,
        dedupedMatches,
        dayCapDroppedRows,
        topOverflowDates,
        overlapRows,
        ruleCandidateChecks,
      }),
    )
    return
  }

  await runInputPass({
    countSourceRows: true,
    onMatchRow: async (matchRow) => {
      preFilterRawMatches += 1
      const bucket = targetDatesBySymbol.get(matchRow.symbol) ?? new Set()
      bucket.add(matchRow.dateKey)
      targetDatesBySymbol.set(matchRow.symbol, bucket)
    },
  })

  const recommendationCloseRetLookup =
    await buildRecommendationCloseRetLookupForMatchTargets({
      candlePath,
      targetDatesBySymbol,
    })
  const filteredMatchesWriter = await createJsonlWriter(path.join(outDir, "matches.jsonl"))
  const excludedWriter = await createJsonlWriter(
    path.join(outDir, "excluded_matches_recommendation_close_ret_gte.jsonl"),
  )
  const matchAccumulator = createPerfectPrototypeMatchAccumulator({
    rules,
    selectionMode,
    selectionMaxSymbolsPerDay,
  })
  let rawMatches = 0
  let removedRawMatches = 0
  let removedHitMatches = 0
  let removedNegativeMatches = 0
  await runInputPass({
    countSourceRows: false,
    onMatchRow: async (row) => {
      const recommendationCloseRetPct = recommendationCloseRetLookup.get(`${row.symbol}::${row.dateKey}`)
      if (!Number.isFinite(recommendationCloseRetPct)) {
        throw new Error(
          `Missing recommendation-date close return lookup for ${row.symbol} ${row.dateKey} from ${candlePath}`,
        )
      }
      const enrichedRow = {
        ...row,
        recommendationDateCloseRetPct: Number(recommendationCloseRetPct.toFixed(6)),
      }
      if (Number(enrichedRow.recommendationDateCloseRetPct) >= closeRetFilterGte) {
        removedRawMatches += 1
        if (enrichedRow?.outcomeHitTarget === true) removedHitMatches += 1
        if (enrichedRow?.outcomeHitTarget === false) removedNegativeMatches += 1
        await excludedWriter.writeRow(enrichedRow)
        return
      }
      await filteredMatchesWriter.writeRow(enrichedRow)
      matchAccumulator.consume(enrichedRow)
      rawMatches += 1
    },
  })
  await filteredMatchesWriter.close()
  await excludedWriter.close()
  const {
    dedupedMatches,
    symbolDayDedupedMatches,
    dayCapDroppedRows,
    topOverflowDates,
    overlapRows,
  } = matchAccumulator.finalize()
  await writeJsonl(path.join(outDir, "deduped_symbols.jsonl"), dedupedMatches)
  await writeJson(path.join(outDir, "overlap.json"), {
    overlapRows,
    overlapCount: overlapRows.length,
  })
  await writeJson(
    path.join(outDir, "summary.json"),
    buildApplySelectionSummary({
      inputPath,
      catalog,
      catalogPath,
      catalogDatasetContract,
      inputDatasetContract,
      inputDatasetContractSourcePath: inputDatasetContractFromArtifacts.sourcePath,
      selectionMode,
      recommendationDateCloseRetFilter:
        closeRetFilterGte == null
          ? null
          : {
              gtePct: closeRetFilterGte,
              candlePath,
              removedRawMatches,
              removedHitMatches,
              removedNegativeMatches,
            },
      sourceRows,
      preFilterRawMatches,
      rawMatches,
      selectionMaxSymbolsPerDay,
      symbolDayDedupedMatches,
      dedupedMatches,
      dayCapDroppedRows,
      topOverflowDates,
      overlapRows,
      ruleCandidateChecks,
    }),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
