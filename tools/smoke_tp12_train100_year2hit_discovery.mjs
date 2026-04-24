#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  assertTp12Train100Preflight,
  assertTp12Train100QualityGate,
  buildTp12Train100AtomTable,
  buildTp12Train100DiscoveryReport,
  mineTp12Train100CounterexampleExactCompletion,
  mineTp12Train100ExactCandidates,
  mineTp12Train100NegativeEliminationCandidates,
} from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { buildTp12Train100CounterexamplePartitionReport } from "./build_tp12_train100_counterexample_partition_report.mjs"

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-train100-"))

try {
  const contractPath = path.join(tmp, "contract.json")
  const resumeMigratedContractPath = path.join(tmp, "contract_resume_migrated.json")
  const tokenizedEventsPath = path.join(tmp, "tokenized_events.jsonl")
  const entrySummaryPath = path.join(tmp, "entry_summary.json")
  const preflightPath = path.join(tmp, "preflight.json")
  const atomEventsPath = path.join(tmp, "atom_events.jsonl")
  const atomManifestPath = path.join(tmp, "atom_manifest.json")
  const exactCatalogPath = path.join(tmp, "exact_catalog.jsonl")
  const exactManifestPath = path.join(tmp, "exact_manifest.json")
  const negativeCatalogPath = path.join(tmp, "negative_catalog.jsonl")
  const negativeTracePath = path.join(tmp, "negative_trace.jsonl")
  const negativeManifestPath = path.join(tmp, "negative_manifest.json")
  const counterexampleCatalogPath = path.join(tmp, "counterexample_catalog.jsonl")
  const counterexampleTracePath = path.join(tmp, "counterexample_trace.jsonl")
  const counterexampleManifestPath = path.join(tmp, "counterexample_manifest.json")
  const counterexamplePartialCatalogPath = path.join(tmp, "counterexample_partial_catalog.jsonl")
  const counterexamplePartialManifestPath = path.join(tmp, "counterexample_partial_manifest.json")
  const counterexampleCheckpointPath = path.join(tmp, "counterexample_checkpoint.json")
  const counterexampleResumeCatalogPath = path.join(tmp, "counterexample_resume_catalog.jsonl")
  const counterexampleResumeManifestPath = path.join(tmp, "counterexample_resume_manifest.json")
  const counterexampleResumeCheckpointPath = path.join(tmp, "counterexample_resume_checkpoint.json")
  const counterexamplePartition0CatalogPath = path.join(tmp, "counterexample_partition_0_catalog.jsonl")
  const counterexamplePartition0ManifestPath = path.join(tmp, "counterexample_partition_0_manifest.json")
  const counterexamplePartition1CatalogPath = path.join(tmp, "counterexample_partition_1_catalog.jsonl")
  const counterexamplePartition1ManifestPath = path.join(tmp, "counterexample_partition_1_manifest.json")
  const counterexamplePartitionReportPath = path.join(tmp, "counterexample_partition_report.json")
  const acceptedPath = path.join(tmp, "accepted.jsonl")
  const rejectedPath = path.join(tmp, "rejected.jsonl")
  const qualitySummaryPath = path.join(tmp, "quality.json")
  const reportPath = path.join(tmp, "report.json")

	  await writeJson(contractPath, {
    kind: "tp12_train100_year2hit_discovery_contract_v1",
    patchKey: "tp12_train100_year2hit_discovery_smoke",
    trainDateRange: { from: "2016-01-01", to: "2018-12-31" },
    coreYears: [2016, 2017, 2018],
    target: {
      minHitDecisionDatesPerYear: 2,
      minHitSymbolDatesPerYear: 2,
      minPositiveSymbolDatesTotal: 6,
      requiredTrainPrecision: 1,
      maxFalsePositiveRows: 0,
    },
    preflight: {
      failOnOosPath: true,
      failOnRowOutsideTrainRange: true,
      requireHitTargetField: true,
      requireEntryFeasibilitySummary: true,
      requireEntryFeasibilityStatusPassed: true,
    },
    atomBuilder: {
      includeSourceTokens: true,
      includeTokenFamilies: false,
      includeTokenPrefixAtoms: false,
      includeTokenCountAtoms: false,
      requireContextFeatures: false,
      numericFields: [],
    },
    mining: {
      maxPatternAtoms: 3,
      maxEvaluatedCandidates: 10000,
      maxAtomCount: 20,
      maxSeedAtomMatchRows: 1000,
      minSeedPositiveSymbolDatesTotal: 6,
      minPositiveDecisionDatesTotal: 6,
      emitRejected: false,
    },
    qualityGate: {
      failOnZeroAccepted: true,
      maxTopSymbolShare: 1,
      maxTopDateShare: 1,
      maxTopYearShare: 1,
      requireVerificationComplete: true,
    },
	  })
  await writeJson(resumeMigratedContractPath, {
    ...JSON.parse(await fs.readFile(contractPath, "utf8")),
    patchKey: "tp12_train100_year2hit_discovery_smoke_resume_migrated",
  })

  const rows = []
  for (const year of [2016, 2017, 2018]) {
    for (const day of ["03", "17"]) {
      rows.push({
        symbol: `H${year}${day}`,
        decisionDateKey: `${year}-01-${day}`,
        entryDateKey: `${year}-01-${Number(day) + 1}`,
        hitTarget: true,
        tokens: ["core:train100", "veto:negative_eliminator"],
      })
    }
    rows.push({
      symbol: `N${year}`,
      decisionDateKey: `${year}-02-03`,
      entryDateKey: `${year}-02-04`,
      hitTarget: false,
      tokens: ["veto:negative_eliminator"],
    })
  }
  await writeJsonl(tokenizedEventsPath, rows)
  await writeJson(entrySummaryPath, { kind: "tp12_entry_feasibility_audit_summary_v1", status: "passed", invalidRowCount: 0 })

  const preflight = await assertTp12Train100Preflight({
    contractPath,
    tokenizedEventsPath,
    entryFeasibilitySummaryPath: entrySummaryPath,
    outPath: preflightPath,
  })
  assert.equal(preflight.status, "passed")

  const atomManifest = await buildTp12Train100AtomTable({
    contractPath,
    tokenizedEventsPath,
    outAtomsPath: atomEventsPath,
    outManifestPath: atomManifestPath,
  })
  assert.equal(atomManifest.outputRowCount, rows.length)
  assert.ok(atomManifest.atomCount >= 2)

  const contextContractPath = path.join(tmp, "context_contract.json")
  const contextTokenizedPath = path.join(tmp, "context_tokenized_events.jsonl")
  const contextFeaturesPath = path.join(tmp, "context_features.jsonl")
  const contextAtomEventsPath = path.join(tmp, "context_atom_events.jsonl")
  const contextAtomManifestPath = path.join(tmp, "context_atom_manifest.json")
  await writeJson(contextContractPath, {
    kind: "tp12_train100_year2hit_discovery_contract_v1",
    patchKey: "tp12_train100_context_atom_smoke",
    trainDateRange: { from: "2016-01-01", to: "2016-12-31" },
    coreYears: [2016],
    atomBuilder: {
      includeSourceTokens: true,
      includeTokenFamilies: false,
      includeTokenPrefixAtoms: false,
      includeTokenCountAtoms: false,
      requireContextFeatures: true,
      contextJoinMode: "stream_sorted_symbol_date",
      requiredNumericFields: ["openToCloseReturn", "return1d", "rangePct", "closeLocation", "marketUpRatio", "marketMeanReturn1d", "limitUpProxyCount"],
      numericFields: ["marketMeanReturn1d"],
      numericAtomMode: "bucket_only",
    },
  })
  await writeJsonl(contextTokenizedPath, [
    { symbol: "A00001", decisionDateKey: "2016-01-03", entryDateKey: "2016-01-04", hitTarget: true, tokens: ["core:context"] },
    { symbol: "B00001", decisionDateKey: "2016-01-03", entryDateKey: "2016-01-04", hitTarget: false, tokens: ["core:context"] },
  ])
  await writeJsonl(contextFeaturesPath, [
    {
      symbol: "A00001",
      decisionDateKey: "2016-01-03",
      openToCloseReturn: 0.04,
      return1d: 0.03,
      rangePct: 0.08,
      closeLocation: 0.9,
      marketUpRatio: 0.5,
      marketMeanReturn1d: 0.02,
      limitUpProxyCount: 0,
    },
    {
      symbol: "B00001",
      decisionDateKey: "2016-01-03",
      openToCloseReturn: -0.02,
      return1d: -0.01,
      rangePct: 0.06,
      closeLocation: 0.3,
      marketUpRatio: 0.5,
      marketMeanReturn1d: 0.02,
      limitUpProxyCount: 0,
    },
  ])
  const contextAtomManifest = await buildTp12Train100AtomTable({
    contractPath: contextContractPath,
    tokenizedEventsPath: contextTokenizedPath,
    contextFeaturesPath,
    outAtomsPath: contextAtomEventsPath,
    outManifestPath: contextAtomManifestPath,
  })
  assert.equal(contextAtomManifest.contextJoinMode, "stream_sorted_symbol_date")
  assert.equal(contextAtomManifest.contextRowCount, 2)
  assert.equal(contextAtomManifest.outputRowCount, 2)

  const exactManifest = await mineTp12Train100ExactCandidates({
    contractPath,
    atomEventsPath,
    outCatalogPath: exactCatalogPath,
    outManifestPath: exactManifestPath,
  })
  assert.ok(exactManifest.acceptedCandidateCount >= 1)
  const exactRows = await readJsonl(exactCatalogPath)
  assert.ok(exactRows.some((row) => row.falsePositiveRows === 0 && row.trainPrecision === 1))

  const negativeManifest = await mineTp12Train100NegativeEliminationCandidates({
    contractPath,
    atomEventsPath,
    outCatalogPath: negativeCatalogPath,
    outTracePath: negativeTracePath,
    outManifestPath: negativeManifestPath,
    maxSteps: 3,
    maxSeeds: 20,
  })
  assert.ok(negativeManifest.acceptedCandidateCount >= 1)

  const counterexampleManifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath,
    atomEventsPath,
    outCatalogPath: counterexampleCatalogPath,
    outTracePath: counterexampleTracePath,
    outManifestPath: counterexampleManifestPath,
    maxVisitedStates: 100,
  })
  assert.equal(counterexampleManifest.searchComplete, true)
  assert.ok(counterexampleManifest.acceptedCandidateCount >= 1)

  const partialCounterexampleManifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath,
    atomEventsPath,
    outCatalogPath: counterexamplePartialCatalogPath,
    outManifestPath: counterexamplePartialManifestPath,
    outCheckpointPath: counterexampleCheckpointPath,
    maxVisitedStates: 1,
    maxCounterexampleScan: 1,
    allowIncomplete: true,
  })
  assert.equal(partialCounterexampleManifest.searchComplete, false)
  assert.ok(partialCounterexampleManifest.checkpointPath)
  assert.ok(partialCounterexampleManifest.checkpointSeenSupportPath)
  assert.ok(partialCounterexampleManifest.checkpointFrontierPath)
  await fs.stat(counterexampleCheckpointPath)
  await fs.stat(partialCounterexampleManifest.checkpointSeenSupportPath)
  await fs.stat(partialCounterexampleManifest.checkpointFrontierPath)

	  const resumedCounterexampleManifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath: resumeMigratedContractPath,
    atomEventsPath,
    outCatalogPath: counterexampleResumeCatalogPath,
    outManifestPath: counterexampleResumeManifestPath,
    outCheckpointPath: counterexampleResumeCheckpointPath,
    resumeCheckpointPath: counterexampleCheckpointPath,
    maxVisitedStates: 100,
    maxCounterexampleScan: 1,
  })
  assert.equal(resumedCounterexampleManifest.resumedFromCheckpoint, true)
  assert.equal(resumedCounterexampleManifest.searchComplete, true)

  const partition0Manifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath: resumeMigratedContractPath,
    atomEventsPath,
    outCatalogPath: counterexamplePartition0CatalogPath,
    outManifestPath: counterexamplePartition0ManifestPath,
    resumeCheckpointPath: counterexampleCheckpointPath,
    maxAdditionalVisitedStates: 100,
    maxCounterexampleScan: 1,
    frontierPartitionCount: 2,
    frontierPartitionIndex: 0,
  })
  const partition1Manifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath: resumeMigratedContractPath,
    atomEventsPath,
    outCatalogPath: counterexamplePartition1CatalogPath,
    outManifestPath: counterexamplePartition1ManifestPath,
    resumeCheckpointPath: counterexampleCheckpointPath,
    maxAdditionalVisitedStates: 100,
    maxCounterexampleScan: 1,
    frontierPartitionCount: 2,
    frontierPartitionIndex: 1,
  })
  assert.equal(partition0Manifest.options.frontierPartition.enabled, true)
  assert.equal(partition1Manifest.options.frontierPartition.enabled, true)
  assert.equal(
    partition0Manifest.options.frontierPartition.selectedFrontierSize +
      partition1Manifest.options.frontierPartition.selectedFrontierSize,
    partialCounterexampleManifest.remainingFrontierSize,
  )
  const partitionReport = await buildTp12Train100CounterexamplePartitionReport({
    manifestPaths: [counterexamplePartition0ManifestPath, counterexamplePartition1ManifestPath],
    outJsonPath: counterexamplePartitionReportPath,
  })
  assert.equal(partitionReport.coverageComplete, true)
  assert.equal(partitionReport.partitionCount, 2)

  const quality = await assertTp12Train100QualityGate({
    contractPath,
    candidateCatalogPaths: [exactCatalogPath, negativeCatalogPath, counterexampleCatalogPath],
    outAcceptedPath: acceptedPath,
    outRejectedPath: rejectedPath,
    outSummaryPath: qualitySummaryPath,
  })
  assert.equal(quality.status, "passed")
  assert.ok(quality.acceptedCount >= 1)

  const report = await buildTp12Train100DiscoveryReport({
    contractPath,
    preflightSummaryPath: preflightPath,
    atomManifestPath,
    exactManifestPath,
    negativeManifestPath,
    counterexampleManifestPath,
    qualitySummaryPath,
    outJsonPath: reportPath,
  })
  assert.equal(report.oosRead, false)
  assert.ok(report.acceptedTrain100PatternCount >= 1)

  const forbiddenOosPath = path.join(tmp, "oos_2025_tokenized_events.jsonl")
  await writeJsonl(forbiddenOosPath, rows)
  await assert.rejects(
    () =>
      assertTp12Train100Preflight({
        contractPath,
        tokenizedEventsPath: forbiddenOosPath,
        entryFeasibilitySummaryPath: entrySummaryPath,
        outPath: path.join(tmp, "bad_preflight.json"),
      }),
    /OOS data/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_train100_year2hit_discovery")
