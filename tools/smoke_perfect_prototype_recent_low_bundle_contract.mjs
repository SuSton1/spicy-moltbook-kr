import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import crypto from "node:crypto"

import { writeJson, writeJsonl } from "../src/lib/io.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"
import { PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID } from "../src/lib/perfect_prototype_recent_low_bundle.mjs"

const runNode = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const runNodeExpectFailure = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code !== 0) return resolve()
      reject(new Error(`node ${args.join(" ")} unexpectedly succeeded`))
    })
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recent-low-bundle-"))
  const sourceCatalogPath = path.join(tempRoot, "source_catalog.json")
  const selectionLeaderboardPath = path.join(tempRoot, "selection_leaderboard.json")
  const selectionManifestPath = path.join(tempRoot, "baseline_manifest.json")
  const close28Dir = path.join(tempRoot, "oos_apply_close28")
  const outPath = path.join(tempRoot, "frozen", "catalog.json")
  const failOutPath = path.join(tempRoot, "frozen-fail", "catalog.json")

  const sourceCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_recent_low_bundle_source",
        datasetContract: {
          rowCount: 4,
          baselineLineIds: ["stepb_dplus1_plus_lite_recent_mid_low"],
          baselineLineId: "stepb_dplus1_plus_lite_recent_mid_low",
          discoveryUniverseIds: ["recent_impulse_upto_1d"],
          discoveryUniverseId: "recent_impulse_upto_1d",
          requestedLookbackTradingDaysValues: [1],
          requestedLookbackTradingDays: 1,
          enabledRecentImpulseLanes: ["recent_impulse_1d"],
          allowedStepALanes: ["recent_impulse_1d"],
          includeSameDayHigh8Values: [false],
          includeSameDayHigh8: false,
        },
      },
      rules: [
        {
          ruleId: "PP_LOW_A",
          familyId: "low_gap_high_continuation",
          tokens: ["feat.low.a"],
          trainMatchCount: 6,
          trainHitCount: 6,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_LOW_B",
          familyId: "low_jump_below_continuation",
          tokens: ["feat.low.b"],
          trainMatchCount: 6,
          trainHitCount: 6,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_LOW_C",
          familyId: "low_gap_top_continuation",
          tokens: ["feat.low.c"],
          trainMatchCount: 6,
          trainHitCount: 6,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
      ],
    },
    sourceRunId: "smoke_recent_low_bundle_source",
  })
  await writeJson(sourceCatalogPath, sourceCatalog)

  await writeJson(selectionLeaderboardPath, [
    {
      selectionRank: 1,
      ruleId: "PP_LOW_A",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 1,
      openOosHitCount: 1,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 1,
      openOosUniqueMatchedSymbols: 1,
      openOosClose28MatchedRows: 1,
    },
    {
      selectionRank: 2,
      ruleId: "PP_LOW_B",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 3,
      openOosHitCount: 1,
      openOosNegativeCount: 2,
      openOosPrecision: 1 / 3,
      openOosUniqueMatchedDates: 3,
      openOosUniqueMatchedSymbols: 3,
      openOosClose28MatchedRows: 3,
    },
    {
      selectionRank: 3,
      ruleId: "PP_LOW_C",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 0,
      openOosHitCount: 0,
      openOosNegativeCount: 0,
      openOosPrecision: 0,
      openOosUniqueMatchedDates: 0,
      openOosUniqueMatchedSymbols: 0,
      openOosClose28MatchedRows: 0,
    },
  ])

  await fs.mkdir(close28Dir, { recursive: true })
  await writeJsonl(path.join(close28Dir, "deduped_symbols.jsonl"), [
    {
      dateKey: "2025-01-09",
      symbol: "319400",
      outcomeHitTarget: false,
      primaryRuleId: "PP_LOW_B",
      matchedRuleIds: ["PP_LOW_B"],
    },
    {
      dateKey: "2025-04-10",
      symbol: "267320",
      outcomeHitTarget: true,
      primaryRuleId: "PP_LOW_B",
      matchedRuleIds: ["PP_LOW_B"],
    },
    {
      dateKey: "2025-06-02",
      symbol: "071090",
      outcomeHitTarget: true,
      primaryRuleId: "PP_LOW_A",
      matchedRuleIds: ["PP_LOW_A"],
    },
    {
      dateKey: "2025-06-18",
      symbol: "005870",
      outcomeHitTarget: false,
      primaryRuleId: "PP_LOW_B",
      matchedRuleIds: ["PP_LOW_B"],
    },
  ])

  const selectionLeaderboardSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(selectionLeaderboardPath))
    .digest("hex")

  await writeJson(selectionManifestPath, {
    runId: "smoke_recent_low_bundle_eval",
    lineId: "stepb_dplus1_plus_lite_recent_mid_low",
    selectionMode: "union_all",
    catalogPath: sourceCatalogPath,
    catalogContentSha256: sourceCatalog?.metadata?.catalogContentSha256 ?? null,
    ruleIdsSha256: sourceCatalog?.metadata?.ruleIdsSha256 ?? null,
    surface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
    openTrainWindow: {
      start: "2020-11-27",
      end: "2024-12-31",
    },
    openOosWindow: {
      start: "2025-01-01",
      end: "2026-01-31",
    },
    oosApplyClose28Dir: close28Dir,
    selectionLeaderboardSha256,
  })

  await runNode(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${sourceCatalogPath}`,
      "--family-ids=low_gap_top_continuation,low_gap_high_continuation,low_jump_below_continuation",
      `--selection-leaderboard=${selectionLeaderboardPath}`,
      `--selection-contract-id=${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID}`,
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=recent_low_bundle",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=recent_low_bundle_shadow",
      "--selection-line-id=stepb_dplus1_plus_lite_recent_mid_low",
      "--selection-surface=v6_contextual_plus_lite_recent_only_lane_local_pool8",
      `--out-path=${outPath}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )

  const curatedCatalog = JSON.parse(await fs.readFile(outPath, "utf8"))
  if (curatedCatalog?.metadata?.selectionContractId !== PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID) {
    throw new Error("recent low bundle curated catalog did not persist selectionContractId")
  }
  if (JSON.stringify(curatedCatalog?.metadata?.selectionBundleRuleIds ?? []) !== JSON.stringify(["PP_LOW_A", "PP_LOW_B"])) {
    throw new Error("recent low bundle curated catalog did not persist the expected bundle rule ids")
  }
  if (curatedCatalog?.metadata?.selectionBundlePromotable !== true) {
    throw new Error("recent low bundle curated catalog did not persist selectionBundlePromotable=true")
  }
  if (Number(curatedCatalog?.metadata?.selectionBundleMetrics?.selectedRows ?? 0) !== 4) {
    throw new Error("recent low bundle curated catalog did not persist selectedRows=4")
  }
  if (Number(curatedCatalog?.metadata?.selectionBundleMetrics?.hitRows ?? 0) !== 2) {
    throw new Error("recent low bundle curated catalog did not persist hitRows=2")
  }

  await runNodeExpectFailure(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${sourceCatalogPath}`,
      "--family-ids=low_gap_top_continuation,low_gap_high_continuation,low_jump_below_continuation",
      `--selection-leaderboard=${selectionLeaderboardPath}`,
      `--selection-contract-id=${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID}`,
      "--min-selection-open-oos-hit-count=4",
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=recent_low_bundle",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=recent_low_bundle_shadow",
      "--selection-line-id=stepb_dplus1_plus_lite_recent_mid_low",
      "--selection-surface=v6_contextual_plus_lite_recent_only_lane_local_pool8",
      `--out-path=${failOutPath}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
