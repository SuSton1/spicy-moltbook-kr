import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import {
  analyzeTp12MotifFalsePositiveContrast,
  assertNeutralMotifAtomName,
  assertTp12PositiveMotifContract,
  buildTp12MotifNegativeControls,
  buildTp12PreHitChartSnapshots,
  buildTp12SymbolicMotifCatalog,
  buildTp12SymbolicMotifFeatures,
  buildTp12TrainLabelUniverse,
  loadTp12PositiveMotifContract,
  mineTp12PositiveMotifConditionalVeto,
  mineTp12PositiveMotifs,
  verifyTp12MotifAnchorsAgainstFullTrain,
  verifyTp12Train100PositiveMotifSurvivors,
  writeTp12Train100PositiveMotifCertificate,
} from "../src/lib/tp12_train100_positive_motif_common.mjs"

const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const contractFor = () => ({
  kind: "tp12_train100_positive_motif_contrastive_contract_v1",
  patchKey: "tp12_train100_positive_motif_contrastive_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  label: { entryPolicy: "GLOBAL_NEXT_SESSION_OPEN", targetPct: 0.12, holdDays: 3, stopPolicy: "NO_STOP" },
  objective: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minTotalPositiveSymbolDates: 18,
    requireFalsePositiveRows: 0,
    requireTrainPrecision: 1,
  },
  expression: {
    form: "positive_motif_anchor_and_not_conditional_veto",
    maxAnchorAtoms: 4,
    maxVetoClauses: 2,
    maxVetoAtomsPerClause: 2,
    maxTotalAtoms: 8,
  },
  featurePolicy: {
    useDailyOhlcv: true,
    useCrossSectionRank: true,
    useMarketContext: true,
    useSupportContext: "explicit_optional",
    useSideDaily: false,
    useIntraday: false,
    useThemeSector: false,
  },
  thresholdGrid: {
    rankBuckets: ["bottom20", "bottom30", "mid20_80", "top30", "top20", "top10"],
    states: ["low", "mid", "high", "very_high"],
    counts: [0, 1, 2, 3, 5, 8, 13, 21],
  },
  forbiddenExpressionFields: [
    "symbolIdRaw",
    "dateIdRaw",
    "hitTarget",
    "hitDate",
    "maxForwardReturn",
    "minForwardDrawdown",
    "futureHigh",
    "futureLow",
    "targetBeforeStop",
    "stopBeforeTarget",
    "entryDateFutureOpen",
  ],
  qualityGates: {
    minActiveMonths: 9,
    maxTopSymbolShare: 0.2,
    maxTopMonthShare: 0.25,
    minFeatureFamilyCount: 2,
  },
  searchLimits: {
    maxAnchorStates: 5000,
    maxGeneratedAnchors: 2000,
    maxAnchorsForVeto: 200,
    maxVetoClausesPerAnchor: 500,
    maxVetoStatesPerAnchor: 5000,
  },
  outputPaths: {
    contractAssertSummary: "out/contract_assert_summary.json",
    trainLabelUniverse: "out/train_label_universe.jsonl.gz",
    trainLabelUniverseSummary: "out/train_label_universe_summary.json",
    preHitSnapshots: "out/pre_hit_chart_snapshots.jsonl.gz",
    preHitSnapshotManifest: "out/pre_hit_chart_snapshot_manifest.json",
    symbolicMotifFeatures: "out/symbolic_motif_features_train.jsonl.gz",
    symbolicMotifManifest: "out/symbolic_motif_feature_manifest.json",
    symbolicMotifCatalog: "out/symbolic_motif_catalog.jsonl.gz",
    symbolicMotifCatalogManifest: "out/symbolic_motif_catalog_manifest.json",
    positiveMotifAnchors: "out/positive_motif_anchor_catalog.jsonl.gz",
    positiveMotifMiningSummary: "out/positive_motif_mining_summary.json",
    motifNegativeControls: "out/motif_negative_controls.jsonl.gz",
    motifNegativeControlSummary: "out/motif_negative_control_summary.json",
    anchorFullNegativeVerification: "out/anchor_full_negative_verification.jsonl.gz",
    anchorFullNegativeSummary: "out/anchor_full_negative_summary.json",
    falsePositiveContrastSummary: "out/false_positive_contrast_summary.json",
    vetoClauseCandidates: "out/veto_clause_candidates.jsonl.gz",
    foundPatterns: "out/train100_positive_motif_found_patterns.jsonl.gz",
    rejectedPatterns: "out/train100_positive_motif_rejected_patterns.jsonl.gz",
    vetoSetcoverSummary: "out/positive_motif_veto_setcover_summary.json",
    verifiedSurvivors: "out/train100_positive_motif_verified_survivors.jsonl.gz",
    verifierSummary: "out/train100_positive_motif_verifier_summary.json",
    certificate: "out/train100_positive_motif_certificate.json",
  },
  oosReadAllowed: false,
  fallbackAllowed: false,
})

const fixtureRows = () => {
  const rows = []
  for (const year of years) {
    for (let i = 0; i < 2; i += 1) {
      const month = String(i + 1).padStart(2, "0")
      rows.push({
        symbol: `H${year}${i}`,
        decisionDateKey: `${year}-${month}-10`,
        sourceDateKey: `${year}-${month}-10`,
        entryDateKey: `${year}-${month}-11`,
        hitTarget: true,
        maxForwardReturn: 0.16,
        features: {
          ret3d: 0.12,
          ret5d: 0.15,
          ret20d: 0.2,
          closeLocation: 0.9,
          upperWickRatio: 0.08,
          lowerWickRatio: 0.1,
          bodyToRange: 0.75,
          tradedValueRel20: 2.5,
          rangeRel20: 1.6,
          volumeRel20: 2.2,
          breakout20Strength: 0.03,
        },
      })
    }
    rows.push({
      symbol: `F${year}`,
      decisionDateKey: `${year}-03-10`,
      sourceDateKey: `${year}-03-10`,
      entryDateKey: `${year}-03-11`,
      hitTarget: false,
      maxForwardReturn: 0.04,
      features: {
        ret3d: 0.12,
        ret5d: 0.14,
        ret20d: 0.18,
        closeLocation: 0.88,
        upperWickRatio: 0.84,
        lowerWickRatio: 0.04,
        bodyToRange: 0.2,
        tradedValueRel20: 2.4,
        rangeRel20: 1.7,
        volumeRel20: 2.3,
        breakout20Strength: 0.02,
      },
    })
  }
  return rows
}

export const runTp12PositiveMotifSmoke = async (mode = "pipeline") => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `tp12-positive-motif-${mode}-`))
  try {
    const contract = contractFor()
    const contractPath = path.join(tmp, "contract.json")
    const labelsPath = path.join(tmp, "label_events.jsonl")
    await writeJson(contractPath, contract)
    await writeJsonl(labelsPath, fixtureRows())

    if (mode === "guards" || mode === "pipeline") {
      assert.throws(() => assertNeutralMotifAtomName("badUpperWick"), /polarity/)
      assert.doesNotThrow(() => assertNeutralMotifAtomName("upperWickRatio_high"))
      await assert.rejects(() => loadTp12PositiveMotifContract(contractPath.replace("contract", "oos_contract")), /OOS|not found/)
    }
    if (mode === "contract" || mode === "guards") {
      const summary = await assertTp12PositiveMotifContract({ contractPath, cwd: tmp })
      assert.equal(summary.status, "passed")
      if (mode === "contract" || mode === "guards") return
    }

    await assertTp12PositiveMotifContract({ contractPath, cwd: tmp })
    const universe = await buildTp12TrainLabelUniverse({ contractPath, labelEventsPath: labelsPath, cwd: tmp })
    assert.equal(universe.hitRowCount, 18)
    const snapshots = await buildTp12PreHitChartSnapshots({ contractPath, cwd: tmp })
    assert.equal(snapshots.rowCount, 27)
    const motifFeatures = await buildTp12SymbolicMotifFeatures({ contractPath, cwd: tmp })
    assert.ok(motifFeatures.uniqueMotifAtomCount > 0)
    const catalog = await buildTp12SymbolicMotifCatalog({ contractPath, cwd: tmp })
    assert.ok(catalog.emittedAtomCount > 0)
    const anchors = await mineTp12PositiveMotifs({ contractPath, maxAnchorStates: 5000, maxGeneratedAnchors: 500, cwd: tmp })
    assert.ok(anchors.generatedAnchorCount > 0)
    if (mode === "miner") return
    const negatives = await buildTp12MotifNegativeControls({ contractPath, cwd: tmp })
    assert.ok(negatives.emittedNegativeRows > 0)
    await verifyTp12MotifAnchorsAgainstFullTrain({ contractPath, cwd: tmp })
    const contrast = await analyzeTp12MotifFalsePositiveContrast({ contractPath, cwd: tmp })
    assert.ok(contrast.emittedClauseCount > 0)
    if (mode === "veto") {
      const veto = await mineTp12PositiveMotifConditionalVeto({ contractPath, cwd: tmp })
      assert.ok(veto.foundPatternCount > 0)
      return
    }
    const veto = await mineTp12PositiveMotifConditionalVeto({ contractPath, cwd: tmp })
    assert.ok(veto.foundPatternCount > 0)
    const verified = await verifyTp12Train100PositiveMotifSurvivors({ contractPath, cwd: tmp })
    assert.ok(verified.verifiedPatternCount > 0)
    const certificate = await writeTp12Train100PositiveMotifCertificate({ contractPath, cwd: tmp })
    assert.equal(certificate.conclusion.code, "train100_positive_motif_survivor_found")
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

