#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12PatternBankFoldMonthlyIntegration } from "../src/lib/tp12_pattern_bank_fold_monthly_integration.mjs"
import {
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { sha256TextLines } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-integration-gate-"))

const writeContract = (filePath) =>
  writeJson(filePath, {
    kind: "tp12_pattern_bank_fold_monthly_integration_contract_v1",
    patchKey: "tp12_pattern_bank_fold_monthly_integration_v1",
    dateRanges: {
      internalValidation: { from: "2020-01-01", to: "2020-12-31" },
      lockedFuture: { from: "2025-01-02", to: null },
    },
    hitContract: {
      hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
      hitField: TP12_OPERATIONAL_HIT_FIELD,
    },
    requiredInputs: {
      patternBankSummary: true,
      nonhitPurgeSummary: true,
      foldStabilitySummary: true,
      monthlyCoverageSummary: true,
      patternBundleSummary: false,
      monthlyQuotaSummary: false,
    },
    gates: {
      minPatternBankSurvivors: 1,
      minNonhitPurgeSurvivors: 1,
      minFoldStablePatterns: 1,
      minSelectedPatterns: 2,
      requireSelectedSubsetOfPatternBank: true,
      requireSelectedSubsetOfNonhitPurge: true,
      requireSelectedSubsetOfFoldStable: true,
      requireHashConsistency: true,
      requireExplicitFullMonthKeys: true,
      targetRecommendationsPerFullMonth: 5,
      targetOperationalHitsPerFullMonth: 5,
      minOperationalPrecision: 1,
      maxOperationalMissRows: 0,
      maxNonExecutableRows: 0,
      requireMonthlyCoveragePassed: true,
      requireMonthlyQuotaPassedWhenProvided: true,
      failOnGateFailure: true,
    },
  })

const baseRange = {
  from: "2020-01-01",
  to: "2020-12-31",
  lockedFutureFrom: "2025-01-02",
}

const patternBankSummary = (ids) => ({
  kind: "tp12_year2hit_executable_pattern_bank_summary_v1",
  status: "passed",
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  hitField: TP12_OPERATIONAL_HIT_FIELD,
  dateRange: baseRange,
  survivorPatternIds: ids,
  survivorPatternIdsSha256: sha256TextLines(ids),
})

const nonhitPurgeSummary = (ids) => ({
  kind: "tp12_year2hit_executable_nonhit_purge_summary_v1",
  status: "passed",
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  hitField: TP12_OPERATIONAL_HIT_FIELD,
  dateRange: baseRange,
  survivorPatternIds: ids,
  survivorPatternIdsSha256: sha256TextLines(ids),
})

const foldSummary = (ids) => ({
  kind: "tp12_year2hit_operational_fold_stability_gate_summary_v1",
  status: "passed",
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  hitField: TP12_OPERATIONAL_HIT_FIELD,
  dateRange: { from: "2020-01-01", to: "2020-12-31" },
  lockedFutureFrom: "2025-01-02",
  stablePatternIds: ids,
  selectedPatternIdsSha256: sha256TextLines(ids),
  foldAuditHash: "fold-audit-ok",
})

const monthlyCoverageSummary = ({ ids, missRows = 0, nonExecutableRows = 0, status = "passed" }) => ({
  kind: "tp12_year2hit_monthly_coverage_bundle_optimizer_summary_v1",
  status,
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  hitField: TP12_OPERATIONAL_HIT_FIELD,
  dateRange: baseRange,
  fullMonthKeys: ["2020-01", "2020-02"],
  selectedPatternIds: ids,
  selectedPatternIdsSha256: sha256TextLines(ids),
  unionRowCount: 10,
  bundle: {
    unionMetrics: {
      totalRows: 10,
      operationalHitRows: 10 - missRows,
      operationalMissRows: missRows,
      operationalPrecision: (10 - missRows) / 10,
      nonExecutableRows,
      minRecommendationsPerFullMonth: 5,
      minOperationalHitsPerFullMonth: missRows > 0 ? 4 : 5,
      monthlyStats: [
        {
          monthKey: "2020-01",
          recommendationRows: 5,
          operationalHitRows: missRows > 0 ? 4 : 5,
          operationalMissRows: missRows > 0 ? 1 : 0,
        },
        {
          monthKey: "2020-02",
          recommendationRows: 5,
          operationalHitRows: 5,
          operationalMissRows: 0,
        },
      ],
    },
  },
})

try {
  const contractPath = path.join(tmp, "contract.json")
  const patternBankPath = path.join(tmp, "pattern-bank.json")
  const nonhitPath = path.join(tmp, "nonhit.json")
  const foldPath = path.join(tmp, "fold.json")
  const monthlyPath = path.join(tmp, "monthly.json")
  await writeContract(contractPath)
  await writeJson(patternBankPath, patternBankSummary(["P_A", "P_B", "P_C"]))
  await writeJson(nonhitPath, nonhitPurgeSummary(["P_A", "P_B"]))
  await writeJson(foldPath, foldSummary(["P_A", "P_B"]))
  await writeJson(monthlyPath, monthlyCoverageSummary({ ids: ["P_A", "P_B"] }))

  const passed = await buildTp12PatternBankFoldMonthlyIntegration({
    contractPath,
    patternBankSummaryPath: patternBankPath,
    nonhitPurgeSummaryPath: nonhitPath,
    foldStabilitySummaryPath: foldPath,
    monthlyCoverageSummaryPath: monthlyPath,
    outSummaryPath: path.join(tmp, "passed-summary.json"),
  })
  assert.equal(passed.status, "passed")
  assert.equal(passed.counts.selectedPatternCount, 2)
  assert.equal(passed.monthlyCoverageCheck.minOperationalHitsPerFullMonth, 5)
  assert.equal(passed.finalSelection.selectedPatternIdsSha256, sha256TextLines(["P_A", "P_B"]))

  const missMonthlyPath = path.join(tmp, "monthly-miss.json")
  await writeJson(missMonthlyPath, monthlyCoverageSummary({ ids: ["P_A", "P_B"], missRows: 1 }))
  await assert.rejects(
    () =>
      buildTp12PatternBankFoldMonthlyIntegration({
        contractPath,
        patternBankSummaryPath: patternBankPath,
        nonhitPurgeSummaryPath: nonhitPath,
        foldStabilitySummaryPath: foldPath,
        monthlyCoverageSummaryPath: missMonthlyPath,
        outSummaryPath: path.join(tmp, "miss-summary.json"),
      }),
    /monthly_coverage_monthly_operational_precision_below_min/,
  )

  const nonstableMonthlyPath = path.join(tmp, "monthly-nonstable.json")
  await writeJson(nonstableMonthlyPath, monthlyCoverageSummary({ ids: ["P_A", "P_C"] }))
  await assert.rejects(
    () =>
      buildTp12PatternBankFoldMonthlyIntegration({
        contractPath,
        patternBankSummaryPath: patternBankPath,
        nonhitPurgeSummaryPath: nonhitPath,
        foldStabilitySummaryPath: foldPath,
        monthlyCoverageSummaryPath: nonstableMonthlyPath,
        outSummaryPath: path.join(tmp, "nonstable-summary.json"),
      }),
    /selected_patterns_not_subset_of_nonhit_purge_survivors/,
  )

  const futurePatternBankPath = path.join(tmp, "pattern-bank-future.json")
  await writeJson(futurePatternBankPath, {
    ...patternBankSummary(["P_A", "P_B"]),
    dateRange: { from: "2020-01-01", to: "2025-01-02", lockedFutureFrom: "2025-01-02" },
  })
  await assert.rejects(
    () =>
      buildTp12PatternBankFoldMonthlyIntegration({
        contractPath,
        patternBankSummaryPath: futurePatternBankPath,
        nonhitPurgeSummaryPath: nonhitPath,
        foldStabilitySummaryPath: foldPath,
        monthlyCoverageSummaryPath: monthlyPath,
        outSummaryPath: path.join(tmp, "future-summary.json"),
      }),
    /patternBankSummary_date_range_enters_locked_future/,
  )

  console.log("ok smoke_tp12_pattern_bank_fold_monthly_integration")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
