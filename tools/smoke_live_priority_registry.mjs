import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { loadLivePriorityRegistry } from "../src/lib/live_priority_ops.mjs"

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "live-priority-registry-"))
  const registryPath = path.join(tempRoot, "config", "ops", "live_priority_registry.server.json")
  const primaryCatalogPath = path.join(
    tempRoot,
    "artifacts",
    "curated",
    "frozen",
    "family_a",
    "catalog_alpha",
    "catalog.json",
  )
  const secondaryCatalogPath = path.join(
    tempRoot,
    "artifacts",
    "curated",
    "frozen",
    "family_b",
    "catalog_beta",
    "catalog.json",
  )
  const shadowCatalogPath = path.join(
    tempRoot,
    "artifacts",
    "curated",
    "frozen",
    "family_c",
    "catalog_gamma",
    "catalog.json",
  )
  await writeJson(primaryCatalogPath, { version: 1, rules: [] })
  await writeJson(secondaryCatalogPath, { version: 1, rules: [] })
  await writeJson(shadowCatalogPath, { version: 1, rules: [] })
  await writeJson(registryPath, {
    version: 1,
    registryId: "smoke_registry",
    stackId: "smoke_stack",
    registryRole: "canonical_live_operating_stack",
    contractDocPath: "meta/live_priority_ops_contract.md",
    artifactsDocPath: "meta/live_priority_reusable_artifacts.json",
    targetDateMode: "latest_common_data_date",
    finalUnionPolicy: "priority_first_symbol_dedup",
    recommendationCloseRetFilterGtePct: 28,
    lines: [
      {
        lineId: "secondary",
        priority: 2,
        lineOrder: 20,
        enabled: true,
        lineRole: "same_day_plus_recent_secondary_subset",
        status: "active",
        reportLabel: "Secondary",
        promotionBasis: "smoke secondary subset",
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogPath: path.relative(tempRoot, secondaryCatalogPath),
        expectedCatalogSha256: "b".repeat(64),
        expectedRuleIdsSha256: "c".repeat(64),
        discoveryUniverseId: "same_day_plus_recent_upto_7d",
        lookbackTradingDays: 7,
      },
      {
        lineId: "primary",
        priority: 1,
        lineOrder: 10,
        enabled: true,
        lineRole: "afree_primary_subset",
        status: "active",
        reportLabel: "Primary",
        promotionBasis: "smoke primary subset",
        runnerType: "afree_stepb_open",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogPath: path.relative(tempRoot, primaryCatalogPath),
        expectedCatalogSha256: "a".repeat(64),
        expectedRuleIdsSha256: "d".repeat(64),
        discoveryUniverseId: "afree_open",
      },
      {
        lineId: "shadow",
        priority: 3,
        lineOrder: 30,
        enabled: true,
        status: "shadow",
        reportLabel: "Shadow",
        promotionBasis: "smoke shadow subset",
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogPath: path.relative(tempRoot, shadowCatalogPath),
        expectedCatalogSha256: "e".repeat(64),
        expectedRuleIdsSha256: "f".repeat(64),
        discoveryUniverseId: "same_day_plus_recent_upto_1d",
        lookbackTradingDays: 1,
      },
    ],
  })

  const previousRepoRoot = process.env.STOCKDESK_SERVER_REPO_ROOT
  process.env.STOCKDESK_SERVER_REPO_ROOT = tempRoot
  try {
    const registry = await loadLivePriorityRegistry({
      registryPath,
      cwd: tempRoot,
      toolName: "smoke_live_priority_registry",
    })
    assert.equal(registry.lines.length, 3)
    assert.equal(registry.enabledLines.length, 3)
    assert.equal(registry.lines[0].lineId, "primary")
    assert.equal(registry.lines[1].lineId, "secondary")
    assert.equal(registry.lines[2].lineId, "shadow")
    assert.equal(registry.lines[0].catalogLabel, "catalog_alpha")
    assert.equal(registry.lines[1].catalogLabel, "catalog_beta")
    assert.equal(registry.lines[2].catalogLabel, "catalog_gamma")
    assert.equal(registry.stackId, "smoke_stack")
    assert.equal(registry.registryRole, "canonical_live_operating_stack")
    assert.equal(registry.contractDocPath, "meta/live_priority_ops_contract.md")
    assert.equal(registry.artifactsDocPath, "meta/live_priority_reusable_artifacts.json")
    assert.equal(registry.lines[0].lineRole, "afree_primary_subset")
    assert.equal(registry.lines[1].reportLabel, "Secondary")
    assert.equal(registry.lines[2].lineRole, "shadow_operating_subset")
    assert.equal(registry.registrySha256.length, 64)
  } finally {
    if (previousRepoRoot === undefined) {
      delete process.env.STOCKDESK_SERVER_REPO_ROOT
    } else {
      process.env.STOCKDESK_SERVER_REPO_ROOT = previousRepoRoot
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
