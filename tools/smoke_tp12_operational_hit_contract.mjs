#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import {
  assertTp12OperationalHitRow,
  buildTp12OperationalHitFields,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const buyableHit = buildTp12OperationalHitFields({
  chartHitTarget: true,
  decisionClose: 100,
  entryOpen: 129.49,
  entryVolume: 1,
  entryDateKey: "2024-01-03",
})
assert.equal(buyableHit.operationalHitTarget, true)
assert.equal(buyableHit.entryExecutable, true)
assert.deepEqual(buyableHit.operationalMissReasons, [])

const gapBlocked = buildTp12OperationalHitFields({
  chartHitTarget: true,
  decisionClose: 100,
  entryOpen: 129.5,
  entryVolume: 1,
  entryDateKey: "2024-01-03",
})
assert.equal(gapBlocked.chartHitTarget, true)
assert.equal(gapBlocked.entryExecutable, false)
assert.equal(gapBlocked.operationalHitTarget, false)
assert.deepEqual(gapBlocked.operationalMissReasons, ["entry_gap_gte_29p5pct"])

const zeroVolume = buildTp12OperationalHitFields({
  chartHitTarget: true,
  decisionClose: 100,
  entryOpen: 100,
  entryVolume: 0,
  entryDateKey: "2024-01-03",
})
assert.equal(zeroVolume.operationalHitTarget, false)
assert.deepEqual(zeroVolume.operationalMissReasons, ["entry_volume_lte_zero"])

assert.throws(
  () =>
    assertTp12OperationalHitRow(
      {
        ...buyableHit,
        operationalHitTarget: false,
      },
      { hitField: TP12_OPERATIONAL_HIT_FIELD, context: "bad-row" },
    ),
  /operationalHitTarget invariant mismatch/,
)

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-operational-hit-contract-"))
try {
  const eventsPath = path.join(tmp, "events.jsonl")
  const contractPath = path.join(tmp, "contract.json")
  const summaryPath = path.join(tmp, "train_gate_summary.json")
  await writeJson(contractPath, {
    kind: "tp12_operational_hit_smoke_contract_v1",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    trainDateRange: { from: "2016-01-01", to: "2016-12-31" },
    coreYears: [2016],
    trainGate: {
      hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
      hitField: TP12_OPERATIONAL_HIT_FIELD,
      minHitsPerCoreYear: 1,
      failOnInvalidRows: true,
      failOnZeroSurvivors: true,
      requireCoreYearsWithinTrain: true,
    },
    operationalHit: {
      operationalHitField: TP12_OPERATIONAL_HIT_FIELD,
    },
  })
  await writeJsonl(eventsPath, [
    {
      patternId: "P_OP",
      symbol: "AAA",
      decisionDateKey: "2016-01-02",
      hitTarget: false,
      ...buildTp12OperationalHitFields({
        chartHitTarget: true,
        decisionClose: 100,
        entryOpen: 100,
        entryVolume: 1000,
        entryDateKey: "2016-01-03",
      }),
    },
    {
      patternId: "P_OP",
      symbol: "BBB",
      decisionDateKey: "2016-02-02",
      hitTarget: true,
      ...buildTp12OperationalHitFields({
        chartHitTarget: true,
        decisionClose: 100,
        entryOpen: 130,
        entryVolume: 1000,
        entryDateKey: "2016-02-03",
      }),
    },
  ])
  const summary = await buildTp12Year2hitTrainGateSummary({
    eventsPath,
    contractPath,
    outPath: summaryPath,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.hitField, TP12_OPERATIONAL_HIT_FIELD)
  assert.equal(summary.trainHitRowCount, 1)
  assert.deepEqual(summary.survivorPatternIds, ["P_OP"])
  console.log("ok smoke_tp12_operational_hit_contract")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
