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
  outPath,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract not found: ${contractPath}`)
  const trainGate = await readRequiredSummary(trainGateSummaryPath, "trainGateSummary")
  const optional = []
  if (toText(qualityGateSummaryPath)) optional.push(await readRequiredSummary(qualityGateSummaryPath, "qualityGateSummary"))
  if (toText(operatingGateSummaryPath)) optional.push(await readRequiredSummary(operatingGateSummaryPath, "operatingGateSummary"))
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
    selectorHash: toText(trainGate.summary.selectorHash ?? trainGate.summary.survivorPatternIdsSha256),
    catalogHash: toText(trainGate.summary.catalogHash ?? trainGate.summary.survivorPatternIdsSha256),
    trainGateHash: trainGate.sha256,
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
