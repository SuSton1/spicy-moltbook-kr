import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import { computeFileSha256 } from "../src/lib/live_priority_ops.mjs"

const main = async () => {
  const root = process.cwd()
  const registryPath = path.join(root, "config", "ops", "live_priority_registry.server.json")
  const liveArtifactsPath = path.join(root, "meta", "live_priority_reusable_artifacts.json")
  const afreeArtifactsPath = path.join(root, "meta", "afree_reusable_artifacts.json")
  const contractDocPath = path.join(root, "meta", "live_priority_ops_contract.md")

  const registry = await readJson(registryPath, null)
  const liveArtifacts = await readJson(liveArtifactsPath, null)
  const afreeArtifacts = await readJson(afreeArtifactsPath, null)

  assert.ok(registry && typeof registry === "object")
  assert.ok(liveArtifacts && typeof liveArtifacts === "object")
  assert.ok(afreeArtifacts && typeof afreeArtifacts === "object")

  const registrySha256 = await computeFileSha256(registryPath)
  assert.equal(liveArtifacts.registryPath, "config/ops/live_priority_registry.server.json")
  assert.equal(liveArtifacts.registrySha256, registrySha256)
  assert.equal(liveArtifacts.stackId, registry.stackId)
  assert.equal(liveArtifacts.registryRole, registry.registryRole)
  assert.equal(liveArtifacts.contractDocPath, registry.contractDocPath)
  assert.equal(liveArtifacts.ingestContractDocPath, registry.ingestContractDocPath)
  assert.equal(liveArtifacts.dailyOpsRunner, registry.dailyOpsRunnerPath)
  assert.equal(liveArtifacts.dailyStatePath, registry.dailyStatePath)
  assert.equal(liveArtifacts.targetDateMode, registry.targetDateMode)
  assert.equal(liveArtifacts.finalUnionPolicy, registry.finalUnionPolicy)
  assert.equal(
    Number(liveArtifacts.recommendationCloseRetFilterGtePct ?? 0),
    Number(registry.recommendationCloseRetFilterGtePct ?? 0),
  )
  assert.equal(liveArtifacts.entrypoint, "tools/run_daily_ops_once.sh")
  assert.equal(liveArtifacts.timer, "tools/systemd/stockdesk-lab-lite-daily-ops.timer")
  assert.equal(liveArtifacts.service, "tools/systemd/stockdesk-lab-lite-daily-ops.service")

  const registryLines = Array.isArray(registry.lines) ? registry.lines : []
  const artifactLines = Array.isArray(liveArtifacts.lines) ? liveArtifacts.lines : []
  assert.equal(artifactLines.length, registryLines.length)

  const artifactByLineId = new Map(artifactLines.map((line) => [String(line.lineId), line]))
  for (const registryLine of registryLines) {
    const artifactLine = artifactByLineId.get(String(registryLine.lineId))
    assert.ok(artifactLine, `missing artifact line for ${registryLine.lineId}`)
    assert.equal(artifactLine.priority, registryLine.priority)
    assert.equal(artifactLine.lineOrder, registryLine.lineOrder)
    assert.equal(artifactLine.lineRole, registryLine.lineRole)
    assert.equal(artifactLine.status, registryLine.status)
    assert.equal(artifactLine.reportLabel, registryLine.reportLabel)
    assert.equal(artifactLine.promotionBasis, registryLine.promotionBasis)
    assert.equal(artifactLine.runnerType, registryLine.runnerType)
    assert.equal(artifactLine.selectionMode, registryLine.selectionMode)
    assert.equal(
      Number(artifactLine.excludeRecommendationCloseRetPctGte ?? 0),
      Number(registryLine.excludeRecommendationCloseRetPctGte ?? 0),
    )
    assert.equal(artifactLine.catalogLabel, registryLine.catalogLabel)
    assert.equal(artifactLine.catalogPath, registryLine.catalogPath)
    assert.equal(artifactLine.expectedCatalogSha256, registryLine.expectedCatalogSha256)
    assert.equal(artifactLine.expectedRuleIdsSha256, registryLine.expectedRuleIdsSha256)
    assert.equal(artifactLine.discoveryUniverseId, registryLine.discoveryUniverseId)
    assert.equal(
      Number(artifactLine.lookbackTradingDays ?? 0) || null,
      Number(registryLine.lookbackTradingDays ?? 0) || null,
    )
  }

  const afreePrimary = registryLines.find((line) => String(line.lineId) === "afree_primary")
  assert.ok(afreePrimary, "afree_primary line missing from registry")
  const afreeOperatingCatalog = afreeArtifacts?.dayCappedTop2Operating7RuleCatalog
  assert.ok(afreeOperatingCatalog && typeof afreeOperatingCatalog === "object")
  assert.equal(afreeOperatingCatalog.lineRole, "afree_primary")
  assert.equal(afreeOperatingCatalog.stackMembership?.stackId, registry.stackId)
  assert.equal(afreeOperatingCatalog.stackMembership?.registryPath, liveArtifacts.registryPath)
  assert.equal(afreeOperatingCatalog.stackMembership?.contractDocPath, registry.contractDocPath)
  assert.equal(afreeOperatingCatalog.stackMembership?.artifactsDocPath, registry.artifactsDocPath)
  assert.equal(afreeOperatingCatalog.stackMembership?.lineId, "afree_primary")
  assert.equal(afreeOperatingCatalog.catalogContentSha256, afreePrimary.expectedCatalogSha256)
  assert.equal(afreeOperatingCatalog.ruleIdsSha256, afreePrimary.expectedRuleIdsSha256)
  assert.equal(
    Number(afreeOperatingCatalog.liveApplyContract?.excludeRecommendationCloseRetPctGte ?? 0),
    Number(afreePrimary.excludeRecommendationCloseRetPctGte ?? 0),
  )
  assert.equal(
    path.relative(String(afreeArtifacts.serverRoot), String(afreeOperatingCatalog.catalogPath)),
    afreePrimary.catalogPath,
  )

  const finalUnionFields = Array.isArray(liveArtifacts?.reportContract?.finalUnionFields)
    ? liveArtifacts.reportContract.finalUnionFields
    : []
  for (const field of ["priority", "lineId", "sourceCatalogLabel", "primaryRuleId", "supportingLines"]) {
    assert.ok(finalUnionFields.includes(field), `missing final union field ${field}`)
  }

  const lineSummaryFields = Array.isArray(liveArtifacts?.reportContract?.lineSummaryFields)
    ? liveArtifacts.reportContract.lineSummaryFields
    : []
  for (const field of ["lineId", "priority", "rowsWritten", "rawMatchedRows", "dedupedRows", "runId"]) {
    assert.ok(lineSummaryFields.includes(field), `missing line summary field ${field}`)
  }

  await fs.access(contractDocPath)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
