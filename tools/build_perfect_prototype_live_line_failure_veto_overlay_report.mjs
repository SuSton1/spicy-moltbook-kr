#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import { replayPerfectPrototypeOverlayCatalog } from "../src/lib/perfect_prototype_overlay_catalog_replay.mjs"
import { buildPerfectPrototypeOverlayFailureBank } from "../src/lib/perfect_prototype_overlay_failure_bank.mjs"
import { buildPerfectPrototypeOverlayVetoBank } from "../src/lib/perfect_prototype_overlay_veto_bank.mjs"
import { buildPerfectPrototypeOverlayOosReport } from "../src/lib/perfect_prototype_overlay_oos_report.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_live_line_failure_veto_overlay_report.mjs \\
    --registry=<registry.json> \\
    --scope-manifest=<manifest.json> \\
    --out-dir=<dir> \\
    [--candle-path=<data/candle_daily.jsonl>]`)
}

const parseArgs = (argv) => {
  const args = {
    candlePath: "data/candle_daily.jsonl",
  }
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    }
    if (!arg.startsWith("--")) continue
    const [key, ...rest] = arg.slice(2).split("=")
    const value = rest.join("=")
    switch (key) {
      case "registry":
        args.registryPath = value
        break
      case "scope-manifest":
        args.scopeManifestPath = value
        break
      case "out-dir":
        args.outDir = value
        break
      case "candle-path":
        args.candlePath = value
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (!args.registryPath || !args.scopeManifestPath || !args.outDir) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const loadJsonl = async (filePath) =>
  readJsonl(filePath, {
    strict: true,
  })

const deriveFeatureKeys = (rows = []) =>
  Array.from(
    new Set(
      (Array.isArray(rows) ? rows : []).flatMap((row) => Object.keys(row?.numericFeatureMap ?? {})),
    ),
  ).sort((left, right) => left.localeCompare(right))

const summarizeBankRule = (rule = {}) => ({
  ruleTokens: rule?.ruleTokens ?? null,
  featureKey: rule?.featureKey ?? null,
  operator: rule?.operator ?? null,
  threshold: Number(rule?.threshold ?? Number.NaN),
  positiveSummary: rule?.positiveSummary ?? null,
  negativeSummary: rule?.negativeSummary ?? null,
  vetoedPositiveSummary: rule?.vetoedPositiveSummary ?? null,
  vetoedNegativeSummary: rule?.vetoedNegativeSummary ?? null,
  positiveRetention: Number(rule?.positiveRetention ?? 0),
  negativeRemovalRate: Number(rule?.negativeRemovalRate ?? 0),
  margin: Number(rule?.margin ?? 0),
})

const summarizeReplay = (replay = {}) => ({
  selectionMode: replay?.selectionMode ?? null,
  catalogRuleCount: Number(replay?.catalogRuleCount ?? 0),
  ruleCandidateChecks: Number(replay?.ruleCandidateChecks ?? 0),
  preFilterMatchedRows: Number(replay?.preFilterMatchedRows ?? 0),
  filteredMatchedRows: Number(replay?.filteredMatchedRows ?? 0),
  excludedSummary: replay?.excludedSummary ?? { removedRowCount: 0, removedHitRowCount: 0, removedNegativeRowCount: 0 },
  rawSummary: replay?.rawSummary ?? null,
  dedupedSummary: replay?.dedupedSummary ?? null,
  overlapCount: Array.isArray(replay?.overlapRows) ? replay.overlapRows.length : 0,
  dayCapDroppedCount: Array.isArray(replay?.dayCapDroppedRows) ? replay.dayCapDroppedRows.length : 0,
})

const buildOverlayDataset = (baselineTrainRows = []) => ({
  trainRows: baselineTrainRows,
  trainPositiveRows: baselineTrainRows.filter((row) => row?.outcomeHitTarget === true),
  trainNegativeRows: baselineTrainRows.filter((row) => row?.outcomeHitTarget !== true),
  derivedFeatureKeys: deriveFeatureKeys(baselineTrainRows),
})

const cloneCatalogWithRules = (catalog, rules = []) => ({
  ...catalog,
  rules: Array.isArray(rules) ? rules.slice() : [],
  champion: (Array.isArray(rules) ? rules[0] : [])[0] ?? null,
})

const buildBenchmarkResult = async ({
  benchmarkId,
  catalog,
  line,
  scopeRows,
  candlePath,
} = {}) => {
  const trainReplay = await replayPerfectPrototypeOverlayCatalog({
    rows: scopeRows?.trainRows ?? [],
    catalog,
    selectionMode: line?.selectionMode ?? "union_all",
    closeRetFilterGte: line?.excludeRecommendationCloseRetPctGte ?? null,
    candlePath,
  })
  const oosReplay = await replayPerfectPrototypeOverlayCatalog({
    rows: scopeRows?.oosRows ?? [],
    catalog,
    selectionMode: line?.selectionMode ?? "union_all",
    closeRetFilterGte: line?.excludeRecommendationCloseRetPctGte ?? null,
    candlePath,
  })
  const overlayDataset = buildOverlayDataset(trainReplay.dedupedMatches ?? [])
  const failureBank = buildPerfectPrototypeOverlayFailureBank({
    dataset: overlayDataset,
  })
  const vetoBank = buildPerfectPrototypeOverlayVetoBank({
    dataset: overlayDataset,
  })
  const overlayReport = buildPerfectPrototypeOverlayOosReport({
    baselineRows: oosReplay.dedupedMatches ?? [],
    failureBank,
    vetoBank,
    baselineOk: (oosReplay?.dedupedMatches?.length ?? 0) > 0,
    baselineReason: "invalid_or_inconclusive",
  })
  return {
    benchmarkId,
    available: true,
    catalogRuleCount: Array.isArray(catalog?.rules) ? catalog.rules.length : 0,
    exactRuleCount: (Array.isArray(catalog?.rules) ? catalog.rules : []).filter((rule) => Number(rule?.precision ?? 0) >= 1).length,
    trainReplay: summarizeReplay(trainReplay),
    oosReplay: summarizeReplay(oosReplay),
    failureBank: {
      ok: failureBank?.ok === true,
      reason: failureBank?.reason ?? null,
      candidateCount: Number(failureBank?.candidateCount ?? 0),
      qualifiedRuleCount: Number(failureBank?.qualifiedRuleCount ?? 0),
      qualifiedRules: (failureBank?.qualifiedRules ?? []).map((rule) => summarizeBankRule(rule)),
      bestCandidate: failureBank?.bestCandidate ? summarizeBankRule(failureBank.bestCandidate) : null,
    },
    vetoBank: {
      ok: vetoBank?.ok === true,
      reason: vetoBank?.reason ?? null,
      candidateCount: Number(vetoBank?.candidateCount ?? 0),
      qualifiedRuleCount: Number(vetoBank?.qualifiedRuleCount ?? 0),
      qualifiedRules: (vetoBank?.qualifiedRules ?? []).map((rule) => summarizeBankRule(rule)),
      bestCandidate: vetoBank?.bestCandidate ? summarizeBankRule(vetoBank.bestCandidate) : null,
    },
    overlayReport,
  }
}

const writeMarkdown = async (filePath, lines = []) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${Array.isArray(lines) ? lines.join("\n") : String(lines ?? "")}\n`, "utf8")
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.outDir, { recursive: true })

  const [registry, scopeManifest] = await Promise.all([
    readJson(args.registryPath, null),
    readJson(args.scopeManifestPath, null),
  ])
  const scopeLookup = new Map()
  for (const scope of Array.isArray(scopeManifest?.scopes) ? scopeManifest.scopes : []) {
    scopeLookup.set(String(scope?.scopeId ?? "").trim(), {
      ...scope,
      trainRows: await loadJsonl(String(scope?.trainInput ?? "").trim()),
      oosRows: await loadJsonl(String(scope?.oosInput ?? "").trim()),
    })
  }

  const rollupLines = []
  const lineResults = []
  for (const line of Array.isArray(scopeManifest?.lines) ? scopeManifest.lines : []) {
    const scopeId = String(line?.scopeId ?? "").trim()
    const scopeRows = scopeLookup.get(scopeId)
    if (!scopeRows) {
      throw new Error(`scope manifest missing scope rows for ${scopeId} (${line?.lineId ?? "unknown"})`)
    }
    const catalog = await loadPerfectPrototypeCatalog(String(line?.catalogPath ?? "").trim(), {
      expectedCatalogSha256: toText(line?.expectedCatalogSha256),
      expectedRuleIdsSha256: toText(line?.expectedRuleIdsSha256),
    })
    const operatingBenchmark = await buildBenchmarkResult({
      benchmarkId: "operating",
      catalog,
      line,
      scopeRows,
      candlePath: args.candlePath,
    })
    const exactRules = (Array.isArray(catalog?.rules) ? catalog.rules : []).filter((rule) => Number(rule?.precision ?? 0) >= 1)
    let exactOnlyBenchmark = {
      benchmarkId: "exact_only",
      available: false,
      reason: "no_exact_rules_in_catalog",
    }
    if (exactRules.length > 0) {
      if (exactRules.length === (Array.isArray(catalog?.rules) ? catalog.rules.length : 0)) {
        exactOnlyBenchmark = {
          ...operatingBenchmark,
          benchmarkId: "exact_only",
          sameAsOperating: true,
        }
      } else {
        exactOnlyBenchmark = await buildBenchmarkResult({
          benchmarkId: "exact_only",
          catalog: cloneCatalogWithRules(catalog, exactRules),
          line,
          scopeRows,
          candlePath: args.candlePath,
        })
      }
    }

    const linePayload = {
      lineId: line?.lineId ?? null,
      priority: Number(line?.priority ?? 0) || null,
      reportLabel: line?.reportLabel ?? null,
      runnerType: line?.runnerType ?? null,
      scopeId,
      discoveryUniverseId: scopeRows?.discoveryUniverseId ?? null,
      lookbackTradingDays: Number(scopeRows?.lookbackTradingDays ?? 0) || null,
      catalogPath: String(line?.catalogPath ?? "").trim() || null,
      operatingBenchmark,
      exactOnlyBenchmark,
    }
    lineResults.push(linePayload)

    const baseFileStem = `line_${String(line?.lineId ?? "unknown")}`
    await Promise.all([
      writeJson(path.join(args.outDir, `${baseFileStem}_baseline_summary.json`), {
        lineId: linePayload.lineId,
        operatingBenchmark: {
          trainReplay: operatingBenchmark.trainReplay,
          oosReplay: operatingBenchmark.oosReplay,
        },
        exactOnlyBenchmark:
          exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
            ? {
                trainReplay: exactOnlyBenchmark.trainReplay,
                oosReplay: exactOnlyBenchmark.oosReplay,
                sameAsOperating: exactOnlyBenchmark.sameAsOperating === true,
              }
            : exactOnlyBenchmark,
      }),
      writeJson(path.join(args.outDir, `${baseFileStem}_failure_bank_summary.json`), {
        lineId: linePayload.lineId,
        operatingBenchmark: operatingBenchmark.failureBank,
        exactOnlyBenchmark:
          exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
            ? exactOnlyBenchmark.failureBank
            : exactOnlyBenchmark,
      }),
      writeJson(path.join(args.outDir, `${baseFileStem}_veto_bank_summary.json`), {
        lineId: linePayload.lineId,
        operatingBenchmark: operatingBenchmark.vetoBank,
        exactOnlyBenchmark:
          exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
            ? exactOnlyBenchmark.vetoBank
            : exactOnlyBenchmark,
      }),
      writeJson(path.join(args.outDir, `${baseFileStem}_overlay_oos_report.json`), {
        lineId: linePayload.lineId,
        operatingBenchmark: operatingBenchmark.overlayReport,
        exactOnlyBenchmark:
          exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
            ? exactOnlyBenchmark.overlayReport
            : exactOnlyBenchmark,
      }),
    ])

    rollupLines.push({
      lineId: linePayload.lineId,
      priority: linePayload.priority,
      reportLabel: linePayload.reportLabel,
      operatingBaselineRows: Number(operatingBenchmark?.oosReplay?.dedupedSummary?.selectedRowCount ?? 0),
      operatingPrecision: Number(operatingBenchmark?.overlayReport?.positiveOnly?.precision ?? 0),
      operatingOverlayPrecision: Number(operatingBenchmark?.overlayReport?.positivePlusFailurePlusVeto?.precision ?? 0),
      operatingFinalAssessment: operatingBenchmark?.overlayReport?.finalAssessment ?? null,
      exactOnlyAvailable: exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true,
      exactOnlyBaselineRows:
        exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
          ? Number(exactOnlyBenchmark?.oosReplay?.dedupedSummary?.selectedRowCount ?? 0)
          : 0,
      exactOnlyFinalAssessment:
        exactOnlyBenchmark?.available === true || exactOnlyBenchmark?.sameAsOperating === true
          ? exactOnlyBenchmark?.overlayReport?.finalAssessment ?? null
          : exactOnlyBenchmark?.reason ?? null,
    })
  }

  await writeJson(path.join(args.outDir, "overlay_registry_snapshot.json"), {
    registryId: registry?.registryId ?? null,
    registryPath: path.resolve(args.registryPath),
    scopeManifestPath: path.resolve(args.scopeManifestPath),
    lineCount: lineResults.length,
    scopeCount: scopeLookup.size,
    lines: lineResults.map((entry) => ({
      lineId: entry.lineId,
      priority: entry.priority,
      reportLabel: entry.reportLabel,
      runnerType: entry.runnerType,
      scopeId: entry.scopeId,
      catalogPath: entry.catalogPath,
    })),
  })
  await writeJson(path.join(args.outDir, "overlay_rollup.json"), {
    generatedAt: new Date().toISOString(),
    lineCount: rollupLines.length,
    lines: rollupLines,
  })
  await writeMarkdown(path.join(args.outDir, "report.md"), [
    "# v60b live-line failure/veto overlay diagnostic",
    "",
    `- lineCount: ${rollupLines.length}`,
    ...rollupLines.flatMap((line) => [
      `- ${line.lineId}: operatingBaselineRows=${line.operatingBaselineRows}, operatingFinalAssessment=${line.operatingFinalAssessment}, exactOnlyFinalAssessment=${line.exactOnlyFinalAssessment}`,
    ]),
  ])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
