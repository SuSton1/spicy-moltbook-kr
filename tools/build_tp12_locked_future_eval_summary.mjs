#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const requireHash = ({ manifest, field }) => {
  const value = toText(manifest?.[field])
  if (!value) throw new Error(`locked manifest missing ${field}`)
  return value
}

export const buildTp12LockedFutureEvalSummary = async ({
  contractPath = "meta/tp12_locked_future_eval_protocol_contract.json",
  lockedManifestPath,
  internalValidationSummaryPath,
  replaySummaryPath,
  outPath,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract not found: ${contractPath}`)
  const manifest = await readJson(lockedManifestPath, null)
  if (!manifest) throw new Error(`locked manifest not found: ${lockedManifestPath}`)
  const internal = await readJson(internalValidationSummaryPath, null)
  if (!internal) throw new Error(`internal validation summary not found: ${internalValidationSummaryPath}`)
  const replay = await readJson(replaySummaryPath, null)
  if (!replay) throw new Error(`locked future replay summary not found: ${replaySummaryPath}`)
  const selectorHash = requireHash({ manifest, field: "selectorHash" })
  const catalogHash = requireHash({ manifest, field: "catalogHash" })
  const trainGateHash = requireHash({ manifest, field: "trainGateHash" })
  const failures = []
  if (toText(internal.status) !== "passed") failures.push("internal_validation_not_passed")
  if (toText(internal.selectorHash) && toText(internal.selectorHash) !== selectorHash) failures.push("selector_hash_mismatch")
  if (toText(internal.catalogHash) && toText(internal.catalogHash) !== catalogHash) failures.push("catalog_hash_mismatch")
  if (toText(internal.trainGateHash) !== trainGateHash) failures.push("train_gate_hash_mismatch")
  if (toText(replay.status) && !["measured", "passed"].includes(toText(replay.status))) failures.push("locked_replay_not_measured")
  if (manifest.thresholdLocked !== true) failures.push("threshold_not_locked")
  const payload = {
    kind: "tp12_locked_future_eval_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    lockedFutureDateRange: contract.lockedFutureDateRange ?? null,
    lockedManifestPath: path.resolve(lockedManifestPath),
    internalValidationSummaryPath: path.resolve(internalValidationSummaryPath),
    replaySummaryPath: path.resolve(replaySummaryPath),
    selectorHash,
    catalogHash,
    trainGateHash,
    thresholdLocked: manifest.thresholdLocked === true,
    failures,
    replaySummary: replay,
  }
  await writeJson(outPath, payload)
  if (failures.length > 0) throw new Error(`tp12 locked future eval summary failed: ${failures.join("; ")}`)
  return payload
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const outPath = toText(getFlag(flags, "out", getFlag(flags, "out-summary", "")))
  if (!outPath) throw new Error("build_tp12_locked_future_eval_summary requires --out")
  const summary = await buildTp12LockedFutureEvalSummary({
    contractPath: path.resolve(cwd, toText(getFlag(flags, "contract-path", "meta/tp12_locked_future_eval_protocol_contract.json"))),
    lockedManifestPath: path.resolve(cwd, toText(getFlag(flags, "locked-manifest", ""))),
    internalValidationSummaryPath: path.resolve(cwd, toText(getFlag(flags, "internal-validation-summary", ""))),
    replaySummaryPath: path.resolve(cwd, toText(getFlag(flags, "replay-summary", ""))),
    outPath: path.resolve(cwd, outPath),
  })
  console.log(JSON.stringify({ status: summary.status, selectorHash: summary.selectorHash, outPath: path.resolve(cwd, outPath) }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
