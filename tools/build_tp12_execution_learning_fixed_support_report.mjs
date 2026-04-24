#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"

const toText = (value) => String(value ?? "").trim()

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const safeMean = (values = []) => {
  const safe = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value))
  if (safe.length < 1) return null
  return safe.reduce((sum, value) => sum + value, 0) / safe.length
}

const summarizeCounts = (values = []) =>
  Object.fromEntries(
    Array.from(
      (Array.isArray(values) ? values : []).reduce((acc, value) => {
        const key = toText(value)
        if (!key) return acc
        acc.set(key, Number(acc.get(key) ?? 0) + 1)
        return acc
      }, new Map()).entries(),
    ).sort((left, right) => left[0].localeCompare(right[0])),
  )

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(
    getFlag(flags, "contract-path", "meta/tp12_execution_learning_fixed_support_contract.json"),
  )
  const bundleSummaryPath = toText(getFlag(flags, "bundle-summary-path", ""))
  const labelPath = toText(getFlag(flags, "label-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const expectedPairSignatureSha256 = toText(getFlag(flags, "expected-pair-signature-sha256", ""))
  if (!bundleSummaryPath || !labelPath || !outPath) {
    throw new Error(
      "build_tp12_execution_learning_fixed_support_report requires --bundle-summary-path --label-path --out",
    )
  }
  return {
    contractPath: path.resolve(cwd, contractPath),
    bundleSummaryPath: path.resolve(cwd, bundleSummaryPath),
    labelPath: path.resolve(cwd, labelPath),
    outPath: path.resolve(cwd, outPath),
    expectedPairSignatureSha256,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const [contract, bundleSummary] = await Promise.all([
    readJson(args.contractPath, null),
    readJson(args.bundleSummaryPath, null),
  ])
  if (!contract || typeof contract !== "object") {
    throw new Error(`Missing fixed-support contract: ${args.contractPath}`)
  }
  if (!bundleSummary || typeof bundleSummary !== "object") {
    throw new Error(`Missing execution-learning bundle summary: ${args.bundleSummaryPath}`)
  }
  const expectedBaselineVariantId = toText(contract?.baselineVariantId)
  const actualBaselineVariantId = toText(bundleSummary?.baselineVariantId)
  if (!expectedBaselineVariantId || actualBaselineVariantId !== expectedBaselineVariantId) {
    throw new Error(
      `Fixed-support execution-learning baseline variant mismatch: expected=${expectedBaselineVariantId || "<empty>"} actual=${actualBaselineVariantId || "<empty>"}`,
    )
  }
  const actualPairSignature = toText(bundleSummary?.donorRows?.pairSignatureSha256)
  if (!actualPairSignature) {
    throw new Error("Execution-learning bundle summary is missing donorRows.pairSignatureSha256")
  }
  const expectedPairSignature =
    toText(args.expectedPairSignatureSha256) || toText(contract?.expectedPairSignatureSha256)
  if (expectedPairSignature && expectedPairSignature !== actualPairSignature) {
    throw new Error(
      `Fixed-support execution-learning pair signature mismatch: expected=${expectedPairSignature} actual=${actualPairSignature}`,
    )
  }

  const splitBuckets = new Map()
  await iterateJsonl(args.labelPath, {
    strict: true,
    onRow: async (row) => {
      const split = toText(row?.learningSplitBucket)
      if (!split) {
        throw new Error(`Execution-learning label row is missing learningSplitBucket in ${args.labelPath}`)
      }
      if (!splitBuckets.has(split)) {
        splitBuckets.set(split, [])
      }
      splitBuckets.get(split).push(row)
    },
  })
  if (splitBuckets.size < 1) {
    throw new Error(`Execution-learning label path resolved zero rows: ${args.labelPath}`)
  }

  const splitMetrics = Object.fromEntries(
    Array.from(splitBuckets.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([split, rows]) => [
        split,
        {
          rowCount: rows.length,
          barrierOutcomeCounts: summarizeCounts(rows.map((row) => row?.barrierOutcomeLabel)),
          bestPolicyChoiceCounts: summarizeCounts(rows.map((row) => row?.labels?.bestPolicyChoice)),
          bestExecutionPolicyCounts: summarizeCounts(rows.map((row) => row?.labels?.bestExecutionPolicyId)),
          meanStopFirstNetRet: safeMean(rows.map((row) => row?.labels?.stop_first_net_ret)),
          meanDelay1NetRet: safeMean(rows.map((row) => row?.labels?.delay1_4d_net_ret)),
          meanBestPolicyNetRet: safeMean(rows.map((row) => row?.labels?.bestPolicyNetRet)),
          meanBestExecutionPolicyNetRet: safeMean(rows.map((row) => row?.labels?.bestExecutionPolicyNetRet)),
        },
      ]),
  )

  const report = {
    kind: "tp12_execution_learning_fixed_support_report_v1",
    generatedAt: new Date().toISOString(),
    contractId: toText(contract?.contractId),
    bundleSummaryPath: args.bundleSummaryPath,
    labelPath: args.labelPath,
    baselineVariantId: actualBaselineVariantId,
    supportImmutable: contract?.supportImmutable === true,
    donorPairSignatureSha256: actualPairSignature,
    expectedPairSignatureSha256: expectedPairSignature || null,
    donorRowCount: toNumber(bundleSummary?.donorRows?.rowCount, 0),
    executionLabelRowCount: toNumber(bundleSummary?.executionLabels?.rowCount, 0),
    replaySplit: bundleSummary?.replaySplit ?? null,
    splitMetrics,
    provenance: bundleSummary?.provenance ?? null,
  }
  await writeJson(args.outPath, report)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        donorRowCount: report.donorRowCount,
        executionLabelRowCount: report.executionLabelRowCount,
        donorPairSignatureSha256: report.donorPairSignatureSha256,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
