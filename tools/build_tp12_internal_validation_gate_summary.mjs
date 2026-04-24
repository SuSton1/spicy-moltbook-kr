#!/usr/bin/env node

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const sha256File = async (filePath) => createHash("sha256").update(await fs.readFile(filePath)).digest("hex")

const readRequiredSummary = async (filePath, label) => {
  const resolvedPath = toText(filePath)
  if (!resolvedPath) throw new Error(`${label} path is required`)
  const summary = await readJson(resolvedPath, null)
  if (!summary) throw new Error(`${label} not found: ${resolvedPath}`)
  return { path: path.resolve(resolvedPath), sha256: await sha256File(resolvedPath), summary }
}

export const buildTp12InternalValidationGateSummary = async ({
  contractPath = "meta/tp12_locked_future_eval_protocol_contract.json",
  trainGateSummaryPath,
  qualityGateSummaryPath = "",
  operatingGateSummaryPath = "",
  splitPlanSummaryPath = "",
  foldStabilityGateSummaryPath = "",
  patternBundleSummaryPath = "",
  monthlyQuotaSummaryPath = "",
  outPath,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract not found: ${contractPath}`)
  const trainGate = await readRequiredSummary(trainGateSummaryPath, "trainGateSummary")
  const optional = []
  if (toText(qualityGateSummaryPath)) optional.push(await readRequiredSummary(qualityGateSummaryPath, "qualityGateSummary"))
  if (toText(operatingGateSummaryPath)) optional.push(await readRequiredSummary(operatingGateSummaryPath, "operatingGateSummary"))
  if (toText(splitPlanSummaryPath)) optional.push(await readRequiredSummary(splitPlanSummaryPath, "splitPlanSummary"))
  if (toText(foldStabilityGateSummaryPath)) {
    optional.push(await readRequiredSummary(foldStabilityGateSummaryPath, "foldStabilityGateSummary"))
  }
  if (toText(patternBundleSummaryPath)) optional.push(await readRequiredSummary(patternBundleSummaryPath, "patternBundleSummary"))
  if (toText(monthlyQuotaSummaryPath)) optional.push(await readRequiredSummary(monthlyQuotaSummaryPath, "monthlyQuotaSummary"))
  const summaries = [trainGate, ...optional]
  const failures = []
  for (const item of summaries) {
    if (toText(item.summary.status) !== "passed") failures.push(`summary_not_passed:${path.basename(item.path)}`)
  }
  const range = contract.internalValidationDateRange ?? {}
  const payload = {
    kind: "tp12_internal_validation_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    internalValidationDateRange: range,
    trainGateSummaryPath: trainGate.path,
    trainGateSummarySha256: trainGate.sha256,
    qualityGateSummaryPath: optional.find((item) => item.path === path.resolve(qualityGateSummaryPath))?.path ?? null,
    qualityGateSummarySha256: optional.find((item) => item.path === path.resolve(qualityGateSummaryPath))?.sha256 ?? null,
    operatingGateSummaryPath: optional.find((item) => item.path === path.resolve(operatingGateSummaryPath))?.path ?? null,
    operatingGateSummarySha256: optional.find((item) => item.path === path.resolve(operatingGateSummaryPath))?.sha256 ?? null,
    splitPlanSummaryPath: optional.find((item) => item.path === path.resolve(splitPlanSummaryPath))?.path ?? null,
    splitPlanSummarySha256: optional.find((item) => item.path === path.resolve(splitPlanSummaryPath))?.sha256 ?? null,
    foldStabilityGateSummaryPath:
      optional.find((item) => item.path === path.resolve(foldStabilityGateSummaryPath))?.path ?? null,
    foldStabilityGateSummarySha256:
      optional.find((item) => item.path === path.resolve(foldStabilityGateSummaryPath))?.sha256 ?? null,
    patternBundleSummaryPath: optional.find((item) => item.path === path.resolve(patternBundleSummaryPath))?.path ?? null,
    patternBundleSummarySha256: optional.find((item) => item.path === path.resolve(patternBundleSummaryPath))?.sha256 ?? null,
    monthlyQuotaSummaryPath: optional.find((item) => item.path === path.resolve(monthlyQuotaSummaryPath))?.path ?? null,
    monthlyQuotaSummarySha256: optional.find((item) => item.path === path.resolve(monthlyQuotaSummaryPath))?.sha256 ?? null,
    selectorHash: toText(trainGate.summary.selectorHash ?? trainGate.summary.survivorPatternIdsSha256),
    catalogHash: toText(trainGate.summary.catalogHash ?? trainGate.summary.survivorPatternIdsSha256),
    trainGateHash: trainGate.sha256,
    splitPlanHash: optional.find((item) => item.path === path.resolve(splitPlanSummaryPath))?.sha256 ?? "",
    foldAuditHash: toText(
      optional.find((item) => item.path === path.resolve(foldStabilityGateSummaryPath))?.summary?.foldAuditHash ??
        optional.find((item) => item.path === path.resolve(foldStabilityGateSummaryPath))?.sha256,
    ),
    patternBundleHash: optional.find((item) => item.path === path.resolve(patternBundleSummaryPath))?.sha256 ?? "",
    monthlyQuotaHash: optional.find((item) => item.path === path.resolve(monthlyQuotaSummaryPath))?.sha256 ?? "",
    selectedPatternIdsSha256: toText(
      optional.find((item) => item.path === path.resolve(foldStabilityGateSummaryPath))?.summary?.selectedPatternIdsSha256 ??
        optional.find((item) => item.path === path.resolve(patternBundleSummaryPath))?.summary?.selectedPatternIdsSha256 ??
        trainGate.summary.survivorPatternIdsSha256,
    ),
    failures,
  }
  await writeJson(outPath, payload)
  if (failures.length > 0) throw new Error(`tp12 internal validation gate failed: ${failures.join("; ")}`)
  return payload
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const outPath = toText(getFlag(flags, "out", getFlag(flags, "out-summary", "")))
  if (!outPath) throw new Error("build_tp12_internal_validation_gate_summary requires --out")
  const summary = await buildTp12InternalValidationGateSummary({
    contractPath: path.resolve(cwd, toText(getFlag(flags, "contract-path", "meta/tp12_locked_future_eval_protocol_contract.json"))),
    trainGateSummaryPath: path.resolve(cwd, toText(getFlag(flags, "train-gate-summary", ""))),
    qualityGateSummaryPath: toText(getFlag(flags, "quality-gate-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "quality-gate-summary", "")))
      : "",
    operatingGateSummaryPath: toText(getFlag(flags, "operating-gate-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "operating-gate-summary", "")))
      : "",
    splitPlanSummaryPath: toText(getFlag(flags, "split-plan-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "split-plan-summary", "")))
      : "",
    foldStabilityGateSummaryPath: toText(getFlag(flags, "fold-stability-gate-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "fold-stability-gate-summary", "")))
      : "",
    patternBundleSummaryPath: toText(getFlag(flags, "pattern-bundle-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "pattern-bundle-summary", "")))
      : "",
    monthlyQuotaSummaryPath: toText(getFlag(flags, "monthly-quota-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "monthly-quota-summary", "")))
      : "",
    outPath: path.resolve(cwd, outPath),
  })
  console.log(JSON.stringify({ status: summary.status, trainGateHash: summary.trainGateHash, outPath: path.resolve(cwd, outPath) }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
