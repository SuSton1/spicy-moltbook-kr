import assert from "node:assert/strict"

import {
  buildTechniqueBankDiscoveryRollingContract,
  selectTechniqueBankDiscoveryPlanBanks,
} from "../src/lib/technique_bank_discovery_contract.mjs"

const techniqueContract = {
  contractId: "tp12_technique_discovery_bank_first_v1",
  updatedAt: "2026-04-12T09:30:00+09:00",
  contractPath: "/tmp/technique_grammar_contract.json",
  bankDiscovery: {
    screenMaxSearchStates: 200000,
    minUsableWindows: 5,
    minRollingOosHitRate: 0.3,
    minOosYearsWithHitGe2: 4,
    minSignalsPer20TradingDays: 4,
    maxTop1DateShare: 0.12,
  },
  hardStops: ["do not reopen raw recurrence aggregates"],
  baseLookbackLadderContract: {
    contractId: "tp12_no_stop_lookback_ladder_v1",
    updatedAt: "2026-04-12T09:30:00+09:00",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidates: [
      {
        candidateId: "lb5",
        lookbackTradingDays: 5,
        discoveryUniverseId: "recent_impulse_upto_5d",
        stepALaneSet: ["recent_impulse_1d", "recent_impulse_3d", "recent_impulse_5d"],
      },
    ],
    baseRollingContract: {
      decisionWindow: { from: "2016-08-12", to: "2026-03-27" },
      inputContract: {
        discoveryUniverseId: "recent_impulse_1d",
        requestedLookbackTradingDays: 1,
        stepALaneSet: ["recent_impulse_1d"],
        allowlistPolicy: "tp12_side_daily_control_inputs_v1",
        commonSupportPolicy: "strict_label_boundary",
      },
      labelContract: {
        targetPct: 0.12,
        stopLossPct: 0,
        primaryHoldDays: 3,
        secondaryHoldDays: 4,
        primaryLabelId: "tp12_no_stop_hit_3d",
        secondaryLabelIds: ["tp12_no_stop_hit_4d"],
        targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      },
      searchContract: {
        configPath: "config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_no_stop.json",
        lineId: "perfect-prototype-open",
        contextSurface: "v5_prejump_contextual",
        splitPolicy: "strict_label_boundary",
        selectionMode: "top1_per_day_union",
        foldScheme: "rolling_year",
        maxGapTradingDays: 5,
        minHitCount: 4,
        minTrainMatchedDates: 4,
        minTrainMatchedMonths: 4,
        minTrainMatchedFolds: 3,
        maxRuleSize: 6,
        maxSeedTokens: 8,
        maxRules: 300000,
        screenMaxSearchStates: 200000,
        finalMaxSearchStates: 20000000,
      },
      screenAcceptance: {
        minUsableScreenWindows: 5,
        earlyStopIfFirstTwoWindowsHaveZeroOosSelections: false,
      },
      windows: [],
      hardStops: [],
      notes: [],
    },
  },
}

const planArtifact = {
  kind: "technique_bank_discovery_plan_v1",
  contractId: techniqueContract.contractId,
  selectedBanks: [
    {
      planRank: 1,
      bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      observedScopeIds: ["LOW_GAP_TOP"],
      observedLookbackCandidateIds: ["lb5"],
      shortlistedTemplateCount: 6,
      shortlistedTemplateIds: ["tpl_a", "tpl_b"],
      topTemplateId: "tpl_a",
      allClauseIds: ["anchor_ma120_break", "confirm_close_near_high", "confirm_sponsor_quality"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: [],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_close_near_high", "confirm_sponsor_quality"],
      invalidateClauseIds: ["invalidate_failed_breakout_count20"],
      bankDiscoveryConfig: techniqueContract.bankDiscovery,
    },
  ],
}

const selectedBanks = selectTechniqueBankDiscoveryPlanBanks({
  planArtifact,
  selectedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
})
assert.equal(selectedBanks.length, 1)

const rollingContract = buildTechniqueBankDiscoveryRollingContract({
  techniqueContract,
  planArtifact,
  bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
})
assert.equal(rollingContract.scopeId, "LOW_GAP_TOP")
assert.equal(rollingContract.searchContract.screenMaxSearchStates, 200000)
assert.equal(rollingContract.techniqueBankDiscovery.bankId, "MA_RETEST__LOW_GAP_TOP__lb5")
assert.equal(rollingContract.techniqueBankDiscovery.lookbackCandidateId, "lb5")
assert.deepEqual(rollingContract.techniqueBankDiscovery.allClauseIds, [
  "anchor_ma120_break",
  "confirm_close_near_high",
  "confirm_sponsor_quality",
])
assert.deepEqual(rollingContract.techniqueBankDiscovery.anchorClauseIds, ["anchor_ma120_break"])
assert.deepEqual(rollingContract.techniqueBankDiscovery.confirmClauseIds, ["confirm_close_near_high", "confirm_sponsor_quality"])
console.log("ok smoke_technique_bank_discovery_contract")
