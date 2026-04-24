#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import {
  buildTechniqueClusterTemplateRollingContract,
} from "../src/lib/technique_cluster_template_screen_contract.mjs"
import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { main as buildPlanMain } from "./build_technique_cluster_template_screen_plan.mjs"

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-technique-cluster-template-screen-"))
  const summaryPath = path.join(tmpDir, "cluster_bank_summary.json")
  const outPath = path.join(tmpDir, "cluster_template_plan.json")
  await fs.writeFile(
    summaryPath,
    JSON.stringify(
      {
        kind: "technique_bank_discovery_summary_v1",
        runId: "smoke_cluster_bank",
        banks: [
          {
            clusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
            entryType: "cluster_lane",
            passScreen: true,
            bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
            sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
            clusterId: "cluster_a",
            mechanismId: "MA_RETEST",
            scopeId: "LOW_GAP_TOP",
            lookbackCandidateId: "lb5",
            selectedTemplateEntries: [
              {
                candidateTemplateId: "ma_cluster_leader",
                clusterRole: "leader",
                selectionReason: "cluster_leader",
                seedId: "seed_ma",
                observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
                observedScopeIds: ["LOW_GAP_TOP"],
                observedLookbackCandidateIds: ["lb5"],
                totalEventCount: 24,
                totalHitCount: 8,
                totalHitRate: 0.3333333333,
                coveredYears: 8,
                yearsWithHitGe2: 6,
                yearsWithHitGe1: 8,
                yearsWithEventCountGeMin: 8,
                signalsPer20TradingDays: 8,
                maxYearShare: 0.18,
                allClauseIds: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
                anchorClauseIds: ["anchor_ma120_break"],
                retestClauseIds: [],
                compressionClauseIds: ["compression_compaction20"],
                confirmClauseIds: ["confirm_sponsor_quality"],
                invalidateClauseIds: [],
              },
              {
                candidateTemplateId: "ma_cluster_breadth",
                clusterRole: "breadth",
                selectionReason: "cluster_breadth_variant",
                seedId: "seed_ma",
                observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
                observedScopeIds: ["LOW_GAP_TOP"],
                observedLookbackCandidateIds: ["lb5"],
                totalEventCount: 20,
                totalHitCount: 7,
                totalHitRate: 0.35,
                coveredYears: 8,
                yearsWithHitGe2: 6,
                yearsWithHitGe1: 8,
                yearsWithEventCountGeMin: 8,
                signalsPer20TradingDays: 7.5,
                maxYearShare: 0.17,
                allClauseIds: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
                anchorClauseIds: ["anchor_ma120_break"],
                retestClauseIds: [],
                compressionClauseIds: ["compression_compaction20"],
                confirmClauseIds: ["confirm_sponsor_quality"],
                invalidateClauseIds: ["invalidate_failed_breakout_count20"],
              },
            ],
          },
          {
            clusterBankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5::reserve::BREAKOUT_BASE",
            entryType: "reserve_bank",
            passScreen: true,
            bankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
            sourceBankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
            clusterId: null,
            mechanismId: "BREAKOUT_BASE",
            scopeId: "LOW_GAP_TOP",
            lookbackCandidateId: "lb5",
            selectedTemplateEntries: [],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  )

  await buildPlanMain(
    [
      "--cluster-bank-summary-path",
      summaryPath,
      "--out",
      outPath,
    ].flatMap((value) => (value.startsWith("--") ? [value] : [value])).map((value, index, arr) => {
      if (value.startsWith("--")) {
        const next = arr[index + 1]
        return next && !next.startsWith("--") ? `${value}=${next}` : value
      }
      return null
    }).filter(Boolean),
    { cwd: process.cwd() },
  )

  const plan = await readJson(outPath, null)
  const contract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  assert.equal(plan.kind, "technique_cluster_template_screen_plan_v1")
  assert.equal(plan.selectedTemplateCount, 2)
  assert.equal(plan.selectedTemplates[0].clusterRole, "leader")
  assert.equal(plan.selectedTemplates[1].clusterRole, "breadth")

  const rollingContract = buildTechniqueClusterTemplateRollingContract({
    techniqueContract: contract,
    planArtifact: plan,
    templateId: "ma_cluster_leader",
  })
  assert.equal(rollingContract.techniqueClusterTemplateScreen.clusterRole, "leader")
  assert.equal(rollingContract.techniqueClusterTemplateScreen.sourceClusterBankId, "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a")

  console.log("ok smoke_technique_cluster_template_screen_plan")
}

await main()
