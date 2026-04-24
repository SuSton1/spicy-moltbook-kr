#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { loadConfig } from "../src/lib/config.mjs"
import { readJsonl, writeJson } from "../src/lib/io.mjs"
import { buildPerfectPrototypeFeatureBankContract } from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { buildPerfectPrototype1dRegimeCellSpecs } from "../src/lib/perfect_prototype_1d_regime_cell_contract.mjs"
import { buildPerfectPrototype1dRegimeCellDataset } from "../src/lib/perfect_prototype_1d_regime_cell_dataset.mjs"
import { buildPerfectPrototype1dRegimePositiveBank } from "../src/lib/perfect_prototype_1d_regime_positive_bank.mjs"
import { buildPerfectPrototype1dRegimeFailureBank } from "../src/lib/perfect_prototype_1d_regime_failure_bank.mjs"
import { buildPerfectPrototype1dRegimeVetoBank } from "../src/lib/perfect_prototype_1d_regime_veto_bank.mjs"
import { buildPerfectPrototype1dRegimeOosReport } from "../src/lib/perfect_prototype_1d_regime_oos_report.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_1d_top_mid_low_failure_bank_oos_report.mjs \\
    --config=<config.json> \\
    --train-input=<daily_pack.jsonl> \\
    --train-control-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --oos-control-input=<daily_pack.jsonl> \\
    --out-dir=<dir>`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "1d_top_mid_low_failure_bank_oos_report",
    targetUniverseId: "same_day_plus_recent_upto_1d",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
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
      case "config":
        args.configPath = value
        break
      case "train-input":
        args.trainInput = value
        break
      case "train-control-input":
        args.trainControlInput = value
        break
      case "oos-input":
        args.oosInput = value
        break
      case "oos-control-input":
        args.oosControlInput = value
        break
      case "out-dir":
        args.outDir = value
        break
      case "family-id":
        args.familyId = value
        break
      case "target-universe-id":
        args.targetUniverseId = value
        break
      case "min-train-dates":
        args.minTrainDates = Number(value)
        break
      case "min-train-months":
        args.minTrainMonths = Number(value)
        break
      case "min-train-folds":
        args.minTrainFolds = Number(value)
        break
      case "max-crossfit-negative-windows":
        args.maxCrossfitNegativeWindows = Number(value)
        break
      case "min-oos-match-count":
        args.minOosMatchCount = Number(value)
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (!args.configPath || !args.trainInput || !args.trainControlInput || !args.oosInput || !args.oosControlInput || !args.outDir) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const compactNumericFeatureMap = (numericFeatureMap) => {
  const safeMap = numericFeatureMap && typeof numericFeatureMap === "object" ? numericFeatureMap : {}
  const out = {}
  for (const [featureKey, rawValue] of Object.entries(safeMap)) {
    const value = toFiniteNumber(rawValue)
    if (value === null) continue
    out[featureKey] = value
  }
  return out
}

const mergeNumericFeatureMaps = (...featureMaps) =>
  Object.assign({}, ...featureMaps.map((featureMap) => compactNumericFeatureMap(featureMap)))

const compactCategoricalTokens = (tokens) =>
  Array.from(new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const compactSequence = (values = []) =>
  (Array.isArray(values) ? values : [])
    .map((value) => toFiniteNumber(value))
    .filter(Number.isFinite)

const compactRow = (row) => {
  if (!row || typeof row !== "object") return undefined
  const symbol = toText(row?.symbol)
  const dateKey = toText(row?.dateKey)
  if (!symbol || !dateKey) return undefined
  const outcomeHitTarget =
    typeof row?.outcomeHitTarget === "boolean"
      ? row.outcomeHitTarget
      : typeof row?.eventOutcome?.hitTarget === "boolean"
        ? row.eventOutcome.hitTarget
        : typeof row?.successInWindow === "boolean"
          ? row.successInWindow
          : false
  const categoricalTokens = compactCategoricalTokens([...(row?.categoricalTokens ?? []), ...(row?.contextualTokens ?? [])])
  const numericFeatureMap = mergeNumericFeatureMaps(
    row?.featureVec,
    row?.globalFeatureVec,
    row?.eventFeatureVec,
    row?.marketContextVec,
    row?.xsecEventVec,
    row?.numericFeatureMap,
  )
  return {
    sourceId: toText(row?.sourceId),
    rowKey: toText(row?.rowKey) ?? `${symbol}:${dateKey}:${toText(row?.targetDateKey) ?? "na"}`,
    symbol,
    dateKey,
    decisionDateKey: toText(row?.decisionDateKey) ?? dateKey,
    monthKey: toText(row?.monthKey) ?? (dateKey.length >= 7 ? dateKey.slice(0, 7) : null),
    targetDateKey:
      toText(row?.targetDateKey) ??
      toText(row?.eventOutcome?.entryDateKey) ??
      toText(row?.entryDateKey),
    foldId: toFiniteNumber(row?.foldId),
    windowId: toFiniteNumber(row?.windowId),
    outcomeHitTarget,
    eventOutcome:
      row?.eventOutcome && typeof row.eventOutcome === "object"
        ? {
            ...(typeof row?.eventOutcome?.hitTarget === "boolean" ? { hitTarget: row.eventOutcome.hitTarget } : {}),
            ...(toFiniteNumber(row?.eventOutcome?.netRet) !== null ? { netRet: Number(row.eventOutcome.netRet) } : {}),
            ...(toText(row?.eventOutcome?.entryDateKey) ? { entryDateKey: String(row.eventOutcome.entryDateKey).trim() } : {}),
          }
        : null,
    seq40: compactSequence(row?.seq40),
    seq150: compactSequence(row?.seq150),
    featureVec: compactNumericFeatureMap(row?.featureVec),
    globalFeatureVec: compactNumericFeatureMap(row?.globalFeatureVec),
    eventFeatureVec: compactNumericFeatureMap(row?.eventFeatureVec),
    marketContextVec: compactNumericFeatureMap(row?.marketContextVec),
    xsecEventVec: compactNumericFeatureMap(row?.xsecEventVec),
    numericFeatureMap,
    contextualTokens: categoricalTokens,
    categoricalTokens,
    tokenSet: new Set(categoricalTokens),
  }
}

const loadJsonl = async (filePath) =>
  readJsonl(filePath, {
    strict: true,
    map: (row) => compactRow(row),
  })

const writeMarkdown = async (filePath, lines = []) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${Array.isArray(lines) ? lines.join("\n") : String(lines ?? "")}\n`, "utf8")
}

const formatStage = (stage, summary = {}) =>
  `selected=${Number(summary?.selectedRows ?? 0)}, hit=${Number(summary?.hitRows ?? 0)}, precision=${Number(summary?.precision ?? 0).toFixed(4)}, selectedDates=${Number(summary?.selectedDateCount ?? 0)}, hitDates=${Number(summary?.hitDateCount ?? 0)}`

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const { config, configPath } = await loadConfig({ cwd, configPath: args.configPath })
  await fs.mkdir(args.outDir, { recursive: true })

  const trainRows = await loadJsonl(args.trainInput)
  const trainControlRows = await loadJsonl(args.trainControlInput)
  const oosRows = await loadJsonl(args.oosInput)
  const oosControlRows = await loadJsonl(args.oosControlInput)

  const bankContract = buildPerfectPrototypeFeatureBankContract({
    bankId: "1d_regime_cell_feature_bank_v1",
    targetUniverseId: args.targetUniverseId,
  })
  const sidecarStore = buildPerfectPrototypeFeatureBankSidecarStore({
    family: {
      trainRows: [...trainRows, ...trainControlRows],
      gatedTrainRows: [...trainRows, ...trainControlRows],
      oosRows: [...oosRows, ...oosControlRows],
    },
    bankContract,
  })

  const cellReports = []
  for (const cellSpec of buildPerfectPrototype1dRegimeCellSpecs()) {
    const dataset = buildPerfectPrototype1dRegimeCellDataset({
      cellSpec,
      trainRows,
      trainControlRows,
      oosRows,
      oosControlRows,
      sidecarStore,
      maxDerivedFeatureCount: 12,
    })
    const positiveBank = buildPerfectPrototype1dRegimePositiveBank({
      cellDataset: dataset,
      minTrainDates: args.minTrainDates,
      minTrainMonths: args.minTrainMonths,
      minTrainFolds: args.minTrainFolds,
      maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
      minOosMatchCount: args.minOosMatchCount,
    })
    const failureBank = buildPerfectPrototype1dRegimeFailureBank({
      cellDataset: dataset,
    })
    const vetoBank = buildPerfectPrototype1dRegimeVetoBank({
      cellDataset: dataset,
    })
    const oosReport = buildPerfectPrototype1dRegimeOosReport({
      cellDataset: dataset,
      positiveBank,
      failureBank,
      vetoBank,
    })
    cellReports.push({
      cellId: cellSpec.cellId,
      label: cellSpec.label,
      regime: cellSpec.regime,
      horizonId: cellSpec.horizonId,
      dataset: dataset.summary,
      positiveBank: {
        ok: positiveBank.ok,
        reason: positiveBank.reason,
        candidateCount: positiveBank.candidateCount,
        qualifiedRuleCount: positiveBank.qualifiedRuleCount,
        bestCandidate: positiveBank.bestCandidate
          ? {
              reason: positiveBank.bestCandidate.reason,
              ruleTokens: positiveBank.bestCandidate.ruleTokens,
              trainSummary: positiveBank.bestCandidate.trainSummary,
              oosSummary: positiveBank.bestCandidate.oosSummary,
            }
          : null,
        qualifiedRules: positiveBank.qualifiedRules.map((rule) => ({
          ruleTokens: rule.ruleTokens,
          trainSummary: rule.trainSummary,
          oosSummary: rule.oosSummary,
        })),
        unionTrainSummary: positiveBank.unionTrainSummary,
        unionOosSummary: positiveBank.unionOosSummary,
      },
      failureBank: {
        ok: failureBank.ok,
        reason: failureBank.reason,
        candidateCount: failureBank.candidateCount,
        qualifiedRuleCount: failureBank.qualifiedRuleCount,
        bestCandidate: failureBank.bestCandidate
          ? {
              ruleTokens: failureBank.bestCandidate.ruleTokens,
              negativeSummary: failureBank.bestCandidate.negativeSummary,
              positiveSummary: failureBank.bestCandidate.positiveSummary,
            }
          : null,
        qualifiedRules: failureBank.qualifiedRules.map((rule) => ({
          ruleTokens: rule.ruleTokens,
          negativeSummary: rule.negativeSummary,
        })),
      },
      vetoBank: {
        ok: vetoBank.ok,
        reason: vetoBank.reason,
        candidateCount: vetoBank.candidateCount,
        qualifiedRuleCount: vetoBank.qualifiedRuleCount,
        bestCandidate: vetoBank.bestCandidate,
        qualifiedRules: vetoBank.qualifiedRules,
      },
      oosReport,
    })
  }

  const positiveQualifiedCellCount = cellReports.filter((entry) => entry?.positiveBank?.ok === true).length
  const failureLiftCellCount = cellReports.filter((entry) => Number(entry?.oosReport?.failureDelta?.precisionLift ?? 0) > 0).length
  const vetoLiftCellCount = cellReports.filter((entry) => Number(entry?.oosReport?.vetoDelta?.precisionLift ?? 0) > 0).length
  const summary = {
    ok: positiveQualifiedCellCount > 0,
    reason: positiveQualifiedCellCount > 0 ? null : "unsat_no_positive_bank_cells",
    patchKey: "perfect_proto_1d_top_mid_low_failure_bank_oos_report_v59a",
    familyId: args.familyId,
    targetUniverseId: args.targetUniverseId,
    configPath,
    cellCount: cellReports.length,
    positiveQualifiedCellCount,
    failureLiftCellCount,
    vetoLiftCellCount,
    promotableCellIds: cellReports
      .filter((entry) => entry?.positiveBank?.ok === true && Number(entry?.oosReport?.failureDelta?.precisionLift ?? 0) > 0)
      .map((entry) => entry.cellId),
    cellAssessments: cellReports.map((entry) => ({
      cellId: entry.cellId,
      label: entry.label,
      positiveBankOk: entry?.positiveBank?.ok === true,
      positiveBankReason: entry?.positiveBank?.reason ?? null,
      failureLift: Number(entry?.oosReport?.failureDelta?.precisionLift ?? 0),
      vetoLift: Number(entry?.oosReport?.vetoDelta?.precisionLift ?? 0),
      finalAssessment: entry?.oosReport?.finalAssessment ?? null,
    })),
  }

  await writeJson(path.join(args.outDir, "cell_reports.json"), cellReports)
  await writeJson(path.join(args.outDir, "one_d_top_mid_low_failure_bank_oos_report_summary.json"), summary)
  if (summary.ok !== true) {
    await writeJson(path.join(args.outDir, "no_support_1d_top_mid_low_failure_bank_oos_report_summary.json"), summary)
  }
  await writeMarkdown(
    path.join(args.outDir, "report.md"),
    [
      "# v59a 1D TOP/MID/LOW Failure-Bank OOS Report",
      "",
      `- patchKey: ${summary.patchKey}`,
      `- targetUniverseId: ${summary.targetUniverseId}`,
      `- positiveQualifiedCellCount: ${summary.positiveQualifiedCellCount}`,
      `- failureLiftCellCount: ${summary.failureLiftCellCount}`,
      `- vetoLiftCellCount: ${summary.vetoLiftCellCount}`,
      "",
      ...cellReports.flatMap((entry) => [
        `## ${entry.label}`,
        `- dataset train: ${JSON.stringify(entry.dataset.trainSummary)}`,
        `- dataset oos: ${JSON.stringify(entry.dataset.oosSummary)}`,
        `- positive bank: ok=${entry.positiveBank.ok} qualified=${entry.positiveBank.qualifiedRuleCount} reason=${entry.positiveBank.reason ?? "null"}`,
        `- failure bank: ok=${entry.failureBank.ok} qualified=${entry.failureBank.qualifiedRuleCount} reason=${entry.failureBank.reason ?? "null"}`,
        `- veto bank: ok=${entry.vetoBank.ok} qualified=${entry.vetoBank.qualifiedRuleCount} reason=${entry.vetoBank.reason ?? "null"}`,
        `- positive only: ${formatStage("positiveOnly", entry.oosReport.positiveOnly)}`,
        `- positive + failure: ${formatStage("positivePlusFailure", entry.oosReport.positivePlusFailure)}`,
        `- positive + failure + veto: ${formatStage("positivePlusFailurePlusVeto", entry.oosReport.positivePlusFailurePlusVeto)}`,
        `- failure delta: ${JSON.stringify(entry.oosReport.failureDelta)}`,
        `- veto delta: ${JSON.stringify(entry.oosReport.vetoDelta)}`,
        `- finalAssessment: ${entry.oosReport.finalAssessment}`,
        "",
      ]),
    ],
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
