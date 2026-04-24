#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12Year2hitOperationalEvents } from "../src/lib/tp12_year2hit_operational_event_enricher.mjs"
import { buildTp12Year2hitExecutablePatternBank } from "../src/lib/tp12_year2hit_executable_pattern_bank.mjs"
import { buildTp12Year2hitExecutableNonhitPurgeGate } from "../src/lib/tp12_year2hit_executable_nonhit_purge_gate.mjs"
import { buildTp12Year2hitPatternBundleBank } from "../src/lib/tp12_year2hit_pattern_bundle_selector.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const operationalRow = ({
  patternId,
  symbol,
  decisionDateKey,
  entryDateKey,
  chartHitTarget = true,
  entryExecutable = true,
}) => {
  const operationalHitTarget = chartHitTarget === true && entryExecutable === true
  const operationalMissReasons = operationalHitTarget
    ? []
    : [
        ...(chartHitTarget ? [] : ["not_chart_hit"]),
        ...(entryExecutable ? [] : ["entry_gap_gte_29p5pct"]),
      ]
  return {
    kind: "tp12_executable_consensus_row_v1",
    symbol,
    decisionDateKey,
    supportPatternIds: [patternId],
    supportClusterIds: [`C_${patternId}`],
    supportTokenSet: [`token:${patternId}`],
    tokenFamilies: ["smoke"],
    hitDefinition: "operational_hit_v1",
    primaryHitField: "operationalHitTarget",
    executionPolicyId: "tp12_executable_hit_next_open_gap29p5_volume_v1",
    entryDateKey,
    chartHitTarget,
    entryExecutable,
    operationalHitTarget,
    executableHitTarget: operationalHitTarget,
    operationalMissReasons,
    operationalMissReason: operationalMissReasons[0] ?? null,
    labelClass: operationalHitTarget ? "positive" : entryExecutable ? "hard_negative" : "non_executable_chart_hit",
  }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-exec-pattern-bank-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  const sourceRowsPath = path.join(tmp, "source_rows.jsonl")
  const operationalEventsPath = path.join(tmp, "operational_events.jsonl")
  const operationalSummaryPath = path.join(tmp, "operational_summary.json")
  const bankSummaryPath = path.join(tmp, "bank_summary.json")
  const bankPath = path.join(tmp, "bank.jsonl")
  const bankRejectedPath = path.join(tmp, "bank_rejected.jsonl")
  const purgeSummaryPath = path.join(tmp, "purge_summary.json")
  const purgedPath = path.join(tmp, "purged.jsonl")
  const purgeRejectedPath = path.join(tmp, "purge_rejected.jsonl")
  const bundleSummaryPath = path.join(tmp, "bundle_summary.json")
  const bundlesPath = path.join(tmp, "bundles.jsonl")
  const selectedPatternsPath = path.join(tmp, "selected_patterns.jsonl")
  const unionRowsPath = path.join(tmp, "union_rows.jsonl")

  await writeJson(contractPath, {
    kind: "tp12_year2hit_executable_pattern_bundle_bank_contract_v1",
    dateRanges: {
      internalValidation: { from: "2020-01-01", to: "2021-12-31" },
      lockedFuture: { from: "2025-01-02", to: null },
    },
    hitContract: {
      hitDefinition: "operational_hit_v1",
      hitField: "operationalHitTarget",
      chartHitField: "chartHitTarget",
      entryExecutableField: "entryExecutable",
      executionPolicyId: "tp12_executable_hit_next_open_gap29p5_volume_v1",
    },
    operationalEventBuilder: {
      explodeSupportPatternIds: true,
      keepNonExecutableRows: true,
      failOnZeroEvents: true,
      forbiddenTopLevelFields: ["entryOpen", "entryGapPct", "entryVolume", "hitDateKey", "futureHigh", "futureLow"],
    },
    patternBank: {
      coreYears: [2020, 2021],
      minOperationalHitDatesPerYear: 2,
      minOperationalHitSymbolDatesPerYear: 2,
      failOnZeroSurvivors: true,
    },
    nonhitPurgeGate: {
      maxOperationalMissRows: 0,
      maxNonExecutableRows: 0,
      requireYear2HitPreserved: true,
      failOnZeroSurvivors: true,
    },
    bundleSelector: {
      minPatterns: 2,
      maxPatterns: 4,
      minOperationalHitDatesPerYear: 2,
      minOperationalHitSymbolDatesPerYear: 2,
      maxTopPatternHitShare: 0.75,
      forbidYearFillerFragments: true,
      failOnZeroBundles: true,
    },
  })

  const rows = []
  for (const year of [2020, 2021]) {
    for (const suffix of ["01-02", "02-03"]) {
      rows.push(
        operationalRow({
          patternId: "P_GOOD_A",
          symbol: `GA${year}${suffix.slice(0, 2)}`,
          decisionDateKey: `${year}-${suffix}`,
          entryDateKey: `${year}-${suffix.slice(0, 2)}-04`,
        }),
      )
      rows.push(
        operationalRow({
          patternId: "P_GOOD_B",
          symbol: `GB${year}${suffix.slice(0, 2)}`,
          decisionDateKey: `${year}-${suffix}`,
          entryDateKey: `${year}-${suffix.slice(0, 2)}-04`,
        }),
      )
      rows.push(
        operationalRow({
          patternId: "P_MISS",
          symbol: `PM${year}${suffix.slice(0, 2)}`,
          decisionDateKey: `${year}-${suffix}`,
          entryDateKey: `${year}-${suffix.slice(0, 2)}-04`,
        }),
      )
      rows.push(
        operationalRow({
          patternId: "P_GAP",
          symbol: `PG${year}${suffix.slice(0, 2)}`,
          decisionDateKey: `${year}-${suffix}`,
          entryDateKey: `${year}-${suffix.slice(0, 2)}-04`,
        }),
      )
    }
    rows.push(
      operationalRow({
        patternId: "P_WEAK",
        symbol: `PW${year}`,
        decisionDateKey: `${year}-03-02`,
        entryDateKey: `${year}-03-03`,
      }),
    )
  }
  rows.push(
    operationalRow({
      patternId: "P_MISS",
      symbol: "PMMISS",
      decisionDateKey: "2021-04-02",
      entryDateKey: "2021-04-03",
      chartHitTarget: false,
      entryExecutable: true,
    }),
  )
  rows.push(
    operationalRow({
      patternId: "P_GAP",
      symbol: "PGGAP",
      decisionDateKey: "2021-04-05",
      entryDateKey: "2021-04-06",
      chartHitTarget: true,
      entryExecutable: false,
    }),
  )
  await writeJsonl(sourceRowsPath, rows)

  const operationalSummary = await buildTp12Year2hitOperationalEvents({
    inputPath: sourceRowsPath,
    outEventsPath: operationalEventsPath,
    outSummaryPath: operationalSummaryPath,
    contractPath,
  })
  assert.equal(operationalSummary.status, "passed")
  assert.equal(operationalSummary.patternCount, 5)

  const bankSummary = await buildTp12Year2hitExecutablePatternBank({
    operationalEventsPath,
    contractPath,
    outSummaryPath: bankSummaryPath,
    outBankPath: bankPath,
    outRejectedPath: bankRejectedPath,
  })
  assert.equal(bankSummary.status, "passed")
  assert.deepEqual(bankSummary.survivorPatternIds.sort(), ["P_GAP", "P_GOOD_A", "P_GOOD_B", "P_MISS"])
  const bankRejected = await readJsonl(bankRejectedPath)
  assert.equal(bankRejected.map((row) => row.patternId).includes("P_WEAK"), true)

  const purgeSummary = await buildTp12Year2hitExecutableNonhitPurgeGate({
    bankPath,
    operationalEventsPath,
    contractPath,
    outSummaryPath: purgeSummaryPath,
    outSurvivorsPath: purgedPath,
    outRejectedPath: purgeRejectedPath,
  })
  assert.equal(purgeSummary.status, "passed")
  assert.deepEqual(purgeSummary.survivorPatternIds.sort(), ["P_GOOD_A", "P_GOOD_B"])
  const purgeRejected = await readJsonl(purgeRejectedPath)
  assert.equal(purgeRejected.find((row) => row.patternId === "P_MISS").rejectReasons.includes("operational_miss_rows_above_max"), true)
  assert.equal(purgeRejected.find((row) => row.patternId === "P_GAP").rejectReasons.includes("non_executable_rows_above_max"), true)

  const bundleSummary = await buildTp12Year2hitPatternBundleBank({
    purgedPatternsPath: purgedPath,
    operationalEventsPath,
    contractPath,
    outSummaryPath: bundleSummaryPath,
    outBundlesPath: bundlesPath,
    outSelectedPatternsPath: selectedPatternsPath,
    outUnionRowsPath: unionRowsPath,
  })
  assert.equal(bundleSummary.status, "passed")
  assert.equal(bundleSummary.bundleCount, 1)
  assert.deepEqual(bundleSummary.selectedPatternIds.sort(), ["P_GOOD_A", "P_GOOD_B"])
  assert.equal(bundleSummary.bundle.unionMetrics.operationalMissRows, 0)
  assert.equal(bundleSummary.bundle.unionMetrics.minOperationalHitDatesPerYear, 2)
  assert.equal(bundleSummary.bundle.unionMetrics.topPatternHitShare <= 0.75, true)

  const leakPath = path.join(tmp, "leaky_source_rows.jsonl")
  await writeJsonl(leakPath, [{ ...rows[0], entryOpen: 100 }])
  await assert.rejects(
    () =>
      buildTp12Year2hitOperationalEvents({
        inputPath: leakPath,
        outEventsPath: path.join(tmp, "leak_events.jsonl"),
        outSummaryPath: path.join(tmp, "leak_summary.json"),
        contractPath,
      }),
    /forbidden operational feature field/,
  )

  const futurePath = path.join(tmp, "future_source_rows.jsonl")
  await writeJsonl(futurePath, [
    operationalRow({
      patternId: "P_FUTURE",
      symbol: "FUT",
      decisionDateKey: "2025-01-02",
      entryDateKey: "2025-01-03",
    }),
  ])
  await assert.rejects(
    () =>
      buildTp12Year2hitOperationalEvents({
        inputPath: futurePath,
        outEventsPath: path.join(tmp, "future_events.jsonl"),
        outSummaryPath: path.join(tmp, "future_summary.json"),
        contractPath,
      }),
    /locked future row/,
  )

  console.log("ok smoke_tp12_year2hit_executable_pattern_bundle_bank")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
