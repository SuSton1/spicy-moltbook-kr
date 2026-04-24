#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12ContextConsensusFeatures } from "../src/lib/tp12_context_consensus_joiner.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const root = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-context-consensus-"))
const consensusPath = path.join(root, "consensus.jsonl")
const contextPath = path.join(root, "context.jsonl")
const outPath = path.join(root, "out.jsonl")
const summaryPath = path.join(root, "summary.json")

await writeJsonl(consensusPath, [
  {
    kind: "tp12_symbol_date_consensus_feature_v1",
    decisionDateKey: "2021-01-04",
    symbol: "000010",
    hitTarget: true,
    selectorScore: 3,
    supportClusterCount: 2,
  },
  {
    kind: "tp12_symbol_date_consensus_feature_v1",
    decisionDateKey: "2021-01-05",
    symbol: "000020",
    hitTarget: false,
    selectorScore: 2,
    supportClusterCount: 1,
  },
])

await writeJsonl(contextPath, [
  {
    kind: "tp12_context_feature_v1",
    decisionDateKey: "2021-01-04",
    symbol: "000010",
    asOfFeatureDateKey: "2021-01-04",
    marketUpRatio: 0.6,
    tradedValueRankPct: 0.1,
  },
  {
    kind: "tp12_context_feature_v1",
    decisionDateKey: "2021-01-05",
    symbol: "000020",
    asOfFeatureDateKey: "2021-01-05",
    marketUpRatio: 0.3,
    tradedValueRankPct: 0.8,
  },
])

const summary = await buildTp12ContextConsensusFeatures({
  consensusPath,
  contextPath,
  outPath,
  summaryPath,
  foldId: "outer_2021",
})
assert.equal(summary.status, "passed")
assert.equal(summary.outputRowCount, 2)
assert.equal(summary.missingContextRowCount, 0)
assert.deepEqual(summary.contextFieldNames, ["asOfFeatureDateKey", "marketUpRatio", "tradedValueRankPct"])

const rows = await readJsonl(outPath)
assert.equal(rows[0].kind, "tp12_context_consensus_feature_v1")
assert.equal(rows[0].foldId, "outer_2021")
assert.equal(rows[0].marketUpRatio, 0.6)
assert.equal(rows[1].tradedValueRankPct, 0.8)

await fs.rm(root, { recursive: true, force: true })
console.log("ok")
