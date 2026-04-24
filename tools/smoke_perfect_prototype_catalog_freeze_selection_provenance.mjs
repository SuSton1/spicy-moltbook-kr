import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import crypto from "node:crypto"

import { writeJson } from "../src/lib/io.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-freeze-selection-"))
  const sourceCatalogPath = path.join(tempRoot, "source_catalog.json")
  const selectionLeaderboardPath = path.join(tempRoot, "selection_leaderboard.json")
  const selectionManifestPath = path.join(tempRoot, "open_eval_manifest.json")
  const familySelectionDir = path.join(tempRoot, "family-selection")
  const recentSelectionDir = path.join(tempRoot, "recent-selection")
  const familySourceCatalogPath = path.join(familySelectionDir, "source_catalog.json")
  const familySelectionLeaderboardPath = path.join(familySelectionDir, "selection_leaderboard.json")
  const familySelectionManifestPath = path.join(familySelectionDir, "open_eval_manifest.json")
  const recentSourceCatalogPath = path.join(recentSelectionDir, "source_catalog.json")
  const recentSelectionLeaderboardPath = path.join(recentSelectionDir, "selection_leaderboard.json")
  const recentSelectionManifestPath = path.join(recentSelectionDir, "open_eval_manifest.json")
  const recentSelectionMissingManifestPath = path.join(recentSelectionDir, "selection_only.json")
  const ruleIdsFilePath = path.join(tempRoot, "rule_ids.txt")
  const outPath = path.join(tempRoot, "frozen", "catalog.json")
  const familyOutPath = path.join(tempRoot, "family-frozen", "catalog.json")
  const recentOutPath = path.join(tempRoot, "recent-frozen", "catalog.json")
  await fs.mkdir(familySelectionDir, { recursive: true })
  await fs.mkdir(recentSelectionDir, { recursive: true })

  const sourceCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v3_contextual_plus_lite",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_source",
        datasetContract: {
          rowCount: 3,
          baselineLineIds: ["stepb_dplus1_plus_lite"],
          baselineLineId: "stepb_dplus1_plus_lite",
          discoveryUniverseIds: ["same_day_plus_recent_upto_2d"],
          discoveryUniverseId: "same_day_plus_recent_upto_2d",
          requestedLookbackTradingDaysValues: [2],
          requestedLookbackTradingDays: 2,
          enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
          allowedStepALanes: ["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"],
          includeSameDayHigh8Values: [true],
          includeSameDayHigh8: true,
        },
      },
      rules: [
        {
          ruleId: "PP_ALPHA",
          familyId: "top_close_recent",
          tokens: ["feat.alpha"],
          trainMatchCount: 3,
          trainHitCount: 3,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_BETA",
          familyId: "mid_close_continuation",
          tokens: ["feat.beta", "tag:xsec.closeRank:MID"],
          trainMatchCount: 4,
          trainHitCount: 4,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
      ],
    },
    sourceRunId: "smoke_source",
  })
  await writeJson(sourceCatalogPath, sourceCatalog)
  await writeJson(selectionLeaderboardPath, [
    {
      selectionRank: 1,
      ruleId: "PP_ALPHA",
      openTrainMatchCount: 5,
      openTrainHitCount: 5,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 4,
      openOosHitCount: 4,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 4,
      openOosUniqueMatchedSymbols: 3,
      openOosClose28MatchedRows: 3,
    },
    {
      selectionRank: 2,
      ruleId: "PP_BETA",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 3,
      openOosHitCount: 3,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 3,
      openOosUniqueMatchedSymbols: 2,
      openOosClose28MatchedRows: 2,
    },
  ])
  const selectionLeaderboardSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(selectionLeaderboardPath))
    .digest("hex")
  await writeJson(selectionManifestPath, {
    runId: "smoke_open_eval",
    lineId: "stepb_dplus1_plus_lite",
    selectionMode: "union_all",
    catalogPath: sourceCatalogPath,
    catalogContentSha256: sourceCatalog?.metadata?.catalogContentSha256 ?? null,
    ruleIdsSha256: sourceCatalog?.metadata?.ruleIdsSha256 ?? null,
    surface: "v3_contextual_plus_lite",
    openTrainWindow: {
      start: "2020-11-27",
      end: "2024-12-31",
    },
    openOosWindow: {
      start: "2025-01-01",
      end: "2026-01-31",
    },
    selectionLeaderboardSha256,
  })
  await fs.writeFile(ruleIdsFilePath, "PP_ALPHA\n", "utf8")

  const familySourceCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v5_contextual_plus_lite_lane_local_pool8",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_family_source",
        datasetContract: {
          rowCount: 2,
          baselineLineIds: ["stepb_dplus1_plus_lite_lane_local"],
          baselineLineId: "stepb_dplus1_plus_lite_lane_local",
          discoveryUniverseIds: ["same_day_plus_recent_upto_1d"],
          discoveryUniverseId: "same_day_plus_recent_upto_1d",
          requestedLookbackTradingDaysValues: [1],
          requestedLookbackTradingDays: 1,
          enabledRecentImpulseLanes: ["recent_impulse_1d"],
          allowedStepALanes: ["same_day_high8", "recent_impulse_1d"],
          includeSameDayHigh8Values: [true],
          includeSameDayHigh8: true,
        },
      },
      rules: [
        {
          ruleId: "PP_BETA",
          familyId: "top_close_recent",
          tokens: ["feat.beta", "tag:xsec.closeRank:TOP", "tag:xsecLane.closeRank:TOP"],
          trainMatchCount: 4,
          trainHitCount: 4,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_GAMMA",
          familyId: "top_close_breakout",
          tokens: ["feat.gamma", "tag:xsec.closeRank:TOP", "tag:xsecLane.closeRank:HIGH"],
          trainMatchCount: 5,
          trainHitCount: 5,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
      ],
    },
    sourceRunId: "smoke_family_source",
  })
  await writeJson(familySourceCatalogPath, familySourceCatalog)
  await writeJson(familySelectionLeaderboardPath, [
    {
      selectionRank: 1,
      ruleId: "PP_BETA",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 3,
      openOosHitCount: 3,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 3,
      openOosUniqueMatchedSymbols: 2,
      openOosClose28MatchedRows: 2,
    },
    {
      selectionRank: 2,
      ruleId: "PP_GAMMA",
      openTrainMatchCount: 7,
      openTrainHitCount: 7,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 2,
      openOosHitCount: 2,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 2,
      openOosUniqueMatchedSymbols: 2,
      openOosClose28MatchedRows: 1,
    },
  ])
  const familySelectionLeaderboardSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(familySelectionLeaderboardPath))
    .digest("hex")
  await writeJson(familySelectionManifestPath, {
    runId: "smoke_open_eval_lane_local",
    lineId: "stepb_dplus1_plus_lite_lane_local",
    selectionMode: "union_all",
    catalogPath: familySourceCatalogPath,
    catalogContentSha256: familySourceCatalog?.metadata?.catalogContentSha256 ?? null,
    ruleIdsSha256: familySourceCatalog?.metadata?.ruleIdsSha256 ?? null,
    surface: "v5_contextual_plus_lite_lane_local_pool8",
    openTrainWindow: {
      start: "2020-11-27",
      end: "2024-12-31",
    },
    openOosWindow: {
      start: "2025-01-01",
      end: "2026-01-31",
    },
    selectionLeaderboardSha256: familySelectionLeaderboardSha256,
  })
  const recentSourceCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_recent_source",
        datasetContract: {
          rowCount: 2,
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
          ruleId: "PP_RECENT_MID",
          familyId: "mid_close_continuation",
          tokens: ["feat.recent.mid", "tag:xsec.closeRank:MID", "tag:xsecLane.closeRank:TOP"],
          trainMatchCount: 5,
          trainHitCount: 5,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_RECENT_LOW",
          familyId: "low_close_continuation",
          tokens: ["feat.recent.low", "tag:xsec.closeRank:LOW", "tag:xsecLane.closeRank:HIGH"],
          trainMatchCount: 4,
          trainHitCount: 4,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
      ],
    },
    sourceRunId: "smoke_recent_source",
  })
  await writeJson(recentSourceCatalogPath, recentSourceCatalog)
  await writeJson(recentSelectionLeaderboardPath, [
    {
      selectionRank: 1,
      ruleId: "PP_RECENT_MID",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 4,
      openOosHitCount: 4,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 4,
      openOosUniqueMatchedSymbols: 3,
      openOosClose28MatchedRows: 3,
    },
    {
      selectionRank: 2,
      ruleId: "PP_RECENT_LOW",
      openTrainMatchCount: 5,
      openTrainHitCount: 5,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 3,
      openOosHitCount: 3,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 3,
      openOosUniqueMatchedSymbols: 3,
      openOosClose28MatchedRows: 2,
    },
  ])
  await writeJson(recentSelectionMissingManifestPath, [
    {
      selectionRank: 1,
      ruleId: "PP_RECENT_MID",
      openTrainMatchCount: 6,
      openTrainHitCount: 6,
      openTrainNegativeCount: 0,
      openTrainPrecision: 1,
      openOosMatchCount: 4,
      openOosHitCount: 4,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 4,
      openOosUniqueMatchedSymbols: 3,
      openOosClose28MatchedRows: 3,
    },
  ])
  const recentSelectionLeaderboardSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(recentSelectionLeaderboardPath))
    .digest("hex")
  await writeJson(recentSelectionManifestPath, {
    runId: "smoke_open_eval_recent_only",
    lineId: "stepb_dplus1_plus_lite_recent_mid_low",
    selectionMode: "union_all",
    catalogPath: recentSourceCatalogPath,
    catalogContentSha256: recentSourceCatalog?.metadata?.catalogContentSha256 ?? null,
    ruleIdsSha256: recentSourceCatalog?.metadata?.ruleIdsSha256 ?? null,
    surface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
    openTrainWindow: {
      start: "2020-11-27",
      end: "2024-12-31",
    },
    openOosWindow: {
      start: "2025-01-01",
      end: "2026-01-31",
    },
    selectionLeaderboardSha256: recentSelectionLeaderboardSha256,
  })

  await runNode(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${sourceCatalogPath}`,
      `--rule-ids-file=${ruleIdsFilePath}`,
      `--selection-leaderboard=${selectionLeaderboardPath}`,
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=deploy_exact_only",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=open_oos_exact_only",
      "--selection-line-id=stepb_dplus1_plus_lite",
      "--selection-surface=v3_contextual_plus_lite",
      "--selection-train-start=2020-11-27",
      "--selection-train-end=2024-12-31",
      "--selection-oos-start=2025-01-01",
      "--selection-oos-end=2026-01-31",
      `--out-path=${outPath}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )

  const catalog = JSON.parse(await fs.readFile(outPath, "utf8"))
  const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(outPath), "manifest.json"), "utf8"))
  if (catalog?.metadata?.selectionIntent !== "open_oos_selection") {
    throw new Error("missing selectionIntent on frozen catalog")
  }
  if (catalog?.metadata?.selectionLeaderboardSha256 == null) {
    throw new Error("missing selectionLeaderboardSha256 on frozen catalog")
  }
  if (catalog?.metadata?.selectionBaselineManifestSha256 == null) {
    throw new Error("missing selectionBaselineManifestSha256 on frozen catalog")
  }
  if (catalog?.rules?.[0]?.selectionOpenOosPrecision !== 1) {
    throw new Error("selection metrics were not stamped onto curated rule")
  }
  if (catalog?.metadata?.datasetContract?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error("frozen curated catalog lost datasetContract discovery universe provenance")
  }
  if (JSON.stringify(catalog?.metadata?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("frozen curated catalog lost datasetContract.allowedStepALanes provenance")
  }
  if (catalog?.metadata?.datasetContract?.includeSameDayHigh8 !== true) {
    throw new Error("frozen curated catalog lost datasetContract.includeSameDayHigh8 provenance")
  }
  if (manifest?.selectionProfileId !== "deploy_exact_only") {
    throw new Error("manifest missing selection profile provenance")
  }
  if (manifest?.selectionBaselineManifestSha256 == null) {
    throw new Error("manifest missing selection baseline manifest provenance")
  }
  if (manifest?.datasetContract?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error("frozen manifest lost datasetContract discovery universe provenance")
  }
  if (JSON.stringify(manifest?.allowedStepALanes ?? []) !== JSON.stringify(["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("frozen manifest lost allowedStepALanes provenance")
  }
  if (manifest?.includeSameDayHigh8 !== true) {
    throw new Error("frozen manifest lost includeSameDayHigh8 provenance")
  }

  await runNode(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${familySourceCatalogPath}`,
      "--family-ids=top_close_recent",
      `--selection-leaderboard=${familySelectionLeaderboardPath}`,
      "--min-selection-open-oos-precision=1",
      "--min-selection-open-oos-hit-count=3",
      "--min-selection-open-oos-unique-matched-dates=3",
      "--min-selection-open-oos-close28-matched-rows=2",
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=shadow_mid_family",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=mid_shadow_exact",
      "--selection-line-id=stepb_dplus1_plus_lite_lane_local",
      "--selection-surface=v5_contextual_plus_lite_lane_local_pool8",
      `--out-path=${familyOutPath}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )

  const familyCatalog = JSON.parse(await fs.readFile(familyOutPath, "utf8"))
  if (JSON.stringify(familyCatalog?.metadata?.curatedFamilyIds ?? []) !== JSON.stringify(["top_close_recent"])) {
    throw new Error("family-based curated catalog did not persist curatedFamilyIds")
  }
  if (Array.isArray(familyCatalog?.rules) !== true || familyCatalog.rules.length !== 1) {
    throw new Error("family-based curated catalog expected exactly one selected rule")
  }
  if (String(familyCatalog?.rules?.[0]?.ruleId ?? "") !== "PP_BETA") {
    throw new Error("family-based curated catalog selected the wrong rule")
  }

  await runNodeExpectFailure(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${recentSourceCatalogPath}`,
      "--family-ids=mid_close_continuation",
      `--selection-leaderboard=${recentSelectionMissingManifestPath}`,
      "--min-selection-open-oos-precision=1",
      "--min-selection-open-oos-hit-count=4",
      "--min-selection-open-oos-unique-matched-dates=4",
      "--min-selection-open-oos-close28-matched-rows=3",
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=recent_mid_family",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=recent_mid_shadow_exact",
      `--out-path=${path.join(tempRoot, "recent-frozen-missing-manifest", "catalog.json")}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )

  await runNode(
    [
      "tools/build_curated_perfect_prototype_catalog.mjs",
      `--source-catalog=${recentSourceCatalogPath}`,
      "--family-ids=mid_close_continuation",
      `--selection-leaderboard=${recentSelectionLeaderboardPath}`,
      "--min-selection-open-oos-precision=1",
      "--min-selection-open-oos-hit-count=4",
      "--min-selection-open-oos-unique-matched-dates=4",
      "--min-selection-open-oos-close28-matched-rows=3",
      "--selection-intent=open_oos_selection",
      "--selection-profile-id=recent_mid_family",
      "--selection-profile-version=v1",
      "--selection-mode=union_all",
      "--threshold-profile=recent_mid_shadow_exact",
      "--selection-line-id=stepb_dplus1_plus_lite_recent_mid_low",
      "--selection-surface=v6_contextual_plus_lite_recent_only_lane_local_pool8",
      `--out-path=${recentOutPath}`,
      "--allow-mutable-output=true",
    ],
    process.cwd(),
  )

  const recentCatalog = JSON.parse(await fs.readFile(recentOutPath, "utf8"))
  if (JSON.stringify(recentCatalog?.metadata?.curatedFamilyIds ?? []) !== JSON.stringify(["mid_close_continuation"])) {
    throw new Error("recent-only curated catalog did not persist curatedFamilyIds")
  }
  if (recentCatalog?.metadata?.selectionLineId !== "stepb_dplus1_plus_lite_recent_mid_low") {
    throw new Error("recent-only curated catalog did not persist selectionLineId")
  }
  if (recentCatalog?.metadata?.selectionSurface !== "v6_contextual_plus_lite_recent_only_lane_local_pool8") {
    throw new Error("recent-only curated catalog did not persist selectionSurface")
  }
  if (recentCatalog?.metadata?.selectionContractId !== "recent_only_mid_low_shadow_v1") {
    throw new Error("recent-only curated catalog did not persist selectionContractId")
  }
  if (recentCatalog?.metadata?.selectionDiscoveryUniverseId !== "recent_impulse_upto_1d") {
    throw new Error("recent-only curated catalog did not persist selectionDiscoveryUniverseId")
  }
  if (
    JSON.stringify(recentCatalog?.metadata?.selectionAllowedFamilyIds ?? []) !==
    JSON.stringify(["mid_close_continuation"])
  ) {
    throw new Error("recent-only curated catalog did not persist selectionAllowedFamilyIds")
  }
  if (!String(recentCatalog?.metadata?.selectionManifestPath ?? "").trim()) {
    throw new Error("recent-only curated catalog did not persist selectionManifestPath")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
