import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12Train100NeutralFeatureCatalog } from "../src/lib/tp12_train100_neutral_feature_catalog.mjs"
import { buildTp12Train100NeutralAtomBitsets } from "../src/lib/tp12_train100_neutral_atom_bitsets.mjs"
import { generateTp12Train100NeutralAnchors } from "../src/lib/tp12_train100_neutral_anchor_generator.mjs"
import { mineTp12Train100NeutralAnchorVetoPatterns } from "../src/lib/tp12_train100_neutral_anchor_veto_miner.mjs"
import { verifyTp12Train100NeutralSurvivors } from "../src/lib/tp12_train100_neutral_exact_verifier.mjs"
import { writeTp12Train100NeutralExpressionSpaceCertificate } from "../src/lib/tp12_train100_neutral_certificate_writer.mjs"
import {
  assertNeutralAtomNaming,
  assertNoForbiddenExpressionFields,
  assertNoOosPath,
  assertThresholdInContractGrid,
} from "../src/lib/tp12_train100_neutral_search_guards.mjs"

const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const contractFor = (tmp) => ({
  kind: "tp12_train100_neutral_anchor_veto_certificate_contract_v1",
  patchKey: "tp12_train100_neutral_anchor_veto_certificate_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  labelConfig: { entryPolicy: "GLOBAL_NEXT_SESSION_OPEN", targetPct: 0.12, holdDays: 3, stopPolicy: "NO_STOP" },
  objective: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minTotalPositiveSymbolDates: 18,
    preferredTotalPositiveSymbolDates: 30,
    requireFalsePositiveRows: 0,
    requireTrainPrecision: 1,
  },
  qualityGates: {
    minActiveMonths: 9,
    maxTopSymbolShare: 0.2,
    maxTopMonthShare: 0.25,
    minFeatureFamilyCount: 1,
    requireThresholdCoarsenessPassed: true,
  },
  expression: {
    allowedForms: ["anchor_and_not_conditional_veto"],
    maxAnchorAtoms: 2,
    maxVetoClauses: 2,
    maxVetoAtomsPerClause: 2,
    maxTotalAtoms: 6,
    allowedFeatureSpaceIds: [
      "tp12_fs1_neutral_ohlcv_intensity_v1",
      "tp12_fs2_neutral_candle_shape_v1",
      "tp12_fs3_neutral_liquidity_volume_v1",
      "tp12_fs4_neutral_cross_section_rank_v1",
      "tp12_fs5_neutral_support_consensus_v1",
      "tp12_fs6_neutral_market_context_v1",
      "tp12_fs7_neutral_same_symbol_matured_prior_v1",
    ],
  },
  searchLimits: {
    maxVisitedAnchorStates: 20000,
    maxGeneratedAnchors: 5000,
    maxGeneratedVetoClausesPerAnchor: 1000,
    maxVisitedVetoStatesPerAnchor: 5000,
    allowIncompleteCertificate: true,
  },
  thresholdGrid: {
    percentile: [0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9],
    rankBuckets: ["bottom20", "bottom30", "mid20_80", "top30", "top20", "top10"],
    zScore: [-1.5, -1, -0.5, 0.5, 1, 1.5],
    counts: [0, 1, 2, 3, 5, 8, 13, 21],
    shares: [0.25, 0.5, 0.75],
    days: [5, 10, 20, 40, 60],
    wickRatio: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    closeLocation: [0.25, 0.5, 0.65, 0.8, 0.9],
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
  outputPaths: {
    featureSpaceManifest: "out/feature_space_manifest.json",
    neutralFeatureCatalog: "out/neutral_feature_catalog.jsonl",
    neutralAtomCatalog: "out/neutral_atom_catalog.jsonl.gz",
    neutralAtomBitsetManifest: "out/neutral_atom_bitset_manifest.json",
    neutralAtomSupportSummary: "out/neutral_atom_support_summary.json",
    anchorCatalog: "out/anchor_catalog.jsonl.gz",
    anchorGenerationSummary: "out/anchor_generation_summary.json",
    foundPatterns: "out/found_patterns.jsonl",
    rejectedPatterns: "out/rejected_patterns.jsonl.gz",
    incompleteFrontier: "out/incomplete_frontier.jsonl.gz",
    anchorVetoSearchSummary: "out/search_summary.json",
    survivorVerifierSummary: "out/verifier_summary.json",
    verifiedSurvivors: "out/verified_survivors.jsonl",
    certificateSummary: "out/certificate.json",
    certificateReport: "out/certificate.md",
  },
  oosReadAllowed: false,
  fallbackAllowed: false,
  lockedSelectorAllowed: false,
})

const fixtureRows = () => {
  const rows = []
  for (const year of years) {
    for (let i = 0; i < 2; i += 1) {
      rows.push({
        symbol: `H${year}${i}`,
        decisionDateKey: `${year}-${String(1 + i).padStart(2, "0")}-10`,
        sourceDateKey: `${year}-${String(1 + i).padStart(2, "0")}-10`,
        hitTarget: true,
        ret3d: 0.72,
        closeLocation: 0.82,
        upperWickRatio: 0.1,
        volumeRel20: 2.2,
        tradedValueRel20: 2.1,
      })
    }
    rows.push({
      symbol: `F${year}`,
      decisionDateKey: `${year}-03-10`,
      sourceDateKey: `${year}-03-10`,
      hitTarget: false,
      ret3d: 0.74,
      closeLocation: 0.84,
      upperWickRatio: 0.58,
      volumeRel20: 0.05,
      tradedValueRel20: 0.06,
    })
  }
  return rows
}

export const runTp12Train100NeutralSmoke = async (mode = "pipeline") => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `tp12-neutral-${mode}-`))
  try {
    const contract = contractFor(tmp)
    const contractPath = path.join(tmp, "contract.json")
    const eventsPath = path.join(tmp, "events.jsonl")
    await writeJson(contractPath, contract)
    await writeJsonl(eventsPath, fixtureRows())

    if (mode === "guards" || mode === "pipeline") {
      assert.throws(() => assertNoOosPath("artifacts/oos/result.json"), /OOS/)
      assert.throws(() => assertNeutralAtomNaming({ featureName: "badUpperWick", rolePolarity: "neutral" }), /polarity/)
      assert.doesNotThrow(() => assertNeutralAtomNaming({ featureName: "upperWickRatio_bucket_high", rolePolarity: "neutral" }))
      assert.throws(() => assertNoForbiddenExpressionFields({ hitDate: "2020-01-01" }, contract), /forbidden/)
      assert.throws(
        () => assertThresholdInContractGrid({ thresholdSpec: { type: "percentile", value: 0.77 } }, contract),
        /not in contract grid/,
      )
    }

    const featureManifest = await buildTp12Train100NeutralFeatureCatalog({ contractPath, cwd: tmp })
    assert.ok(featureManifest.atomSpecCount > 0)
    const atomManifest = await buildTp12Train100NeutralAtomBitsets({
      contractPath,
      eventsPath,
      featureCatalogPath: "out/neutral_feature_catalog.jsonl",
      cwd: tmp,
    })
    assert.ok(atomManifest.emittedAtomCount > 0)
    const anchorSummary = await generateTp12Train100NeutralAnchors({
      contractPath,
      atomCatalogPath: "out/neutral_atom_catalog.jsonl.gz",
      eventsPath,
      cwd: tmp,
    })
    assert.ok(anchorSummary.generatedAnchorCount > 0)
    const searchSummary = await mineTp12Train100NeutralAnchorVetoPatterns({
      contractPath,
      anchorsPath: "out/anchor_catalog.jsonl.gz",
      atomCatalogPath: "out/neutral_atom_catalog.jsonl.gz",
      eventsPath,
      cwd: tmp,
    })
    assert.ok(searchSummary.foundPatternCount > 0)
    const verifier = await verifyTp12Train100NeutralSurvivors({
      contractPath,
      patternsPath: "out/found_patterns.jsonl",
      atomCatalogPath: "out/neutral_atom_catalog.jsonl.gz",
      eventsPath,
      cwd: tmp,
    })
    assert.ok(verifier.verifiedPatternCount > 0)
    const certificate = await writeTp12Train100NeutralExpressionSpaceCertificate({ contractPath, cwd: tmp })
    assert.equal(certificate.conclusion.code, "train100_neutral_survivor_found")
    assert.equal(certificate.oosRead, false)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}
