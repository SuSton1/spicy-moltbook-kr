import path from "node:path"
import fs from "node:fs/promises"
import crypto from "node:crypto"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { ensureDir, pathExists, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  applyPerfectPrototypeCatalogFreezeMetadata,
  assertPerfectPrototypeFrozenCatalogOutputPath,
  buildDefaultPerfectPrototypeFrozenCatalogPath,
} from "../src/lib/perfect_prototype_catalog_freeze.mjs"
import {
  buildPerfectPrototypeCatalogManifest,
  resolvePerfectPrototypeCatalogManifestPath,
} from "../src/lib/perfect_prototype_catalog_manifest.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS,
  buildPerfectPrototypeRecentOnlyShadowFamilyIdSet,
  resolvePerfectPrototypeRuleFamilySelection,
} from "../src/lib/perfect_prototype_rule_family_spec.mjs"
import {
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS,
  buildPerfectPrototypeRecentLowBundleFamilyIdSet,
  selectRecentLowShadowBundleCandidate,
} from "../src/lib/perfect_prototype_recent_low_bundle.mjs"
import { pickChampionPerfectPrototypeRule, rankPerfectPrototypeRules } from "../src/lib/perfect_prototype_rule.mjs"
import { buildRecentImpulseUniverseId } from "../src/lib/perfect_prototype_multiline_contract.mjs"
import {
  PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
} from "../src/lib/perfect_prototype_support_case.mjs"

const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID = "stepb_dplus1_plus_lite_recent_mid_low"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_CONTRACT_ID = "recent_only_mid_low_shadow_v1"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE = "v6_contextual_plus_lite_recent_only_lane_local_pool8"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID = buildRecentImpulseUniverseId(1)
const PERFECT_PROTOTYPE_RECENT_ONLY_ALLOWED_CONTRACT_IDS = new Set([
  PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_CONTRACT_ID,
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
  PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
])

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))

const parseRuleIds = ({ ruleIdsRaw, ruleIdsFileRaw }) => {
  const inlineRuleIds = String(ruleIdsRaw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const fileRuleIds = String(ruleIdsFileRaw ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"))
  return uniqueSorted([...inlineRuleIds, ...fileRuleIds])
}

const computeFileSha256 = async (filePath) => {
  const payload = await fs.readFile(filePath)
  return crypto.createHash("sha256").update(payload).digest("hex")
}

const resolveMetricThreshold = (value, fallback = null) => {
  const text = String(value ?? "").trim()
  if (!text) return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const normalizeWindow = (value) => {
  if (!value || typeof value !== "object") return null
  const start = String(value?.start ?? "").trim() || null
  const end = String(value?.end ?? "").trim() || null
  return start || end ? { start, end } : null
}

const windowsEqual = (left, right) => {
  const normalizedLeft = normalizeWindow(left)
  const normalizedRight = normalizeWindow(right)
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

const resolveSelectionManifestDetails = async ({
  selectionLeaderboardPath,
  selectionLeaderboardSha256,
}) => {
  if (!selectionLeaderboardPath) return null
  const baseDir = path.dirname(selectionLeaderboardPath)
  const candidatePaths = [
    path.join(baseDir, "open_eval_manifest.json"),
    path.join(baseDir, "baseline_manifest.json"),
  ]
  const candidates = []
  for (const manifestPath of candidatePaths) {
    if (!pathExists(manifestPath)) continue
    const payload = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    candidates.push({
      manifestPath,
      manifestSha256: await computeFileSha256(manifestPath),
      payload,
    })
  }
  if (candidates.length < 1) {
    throw new Error(
      `selection-leaderboard requires sibling open_eval_manifest.json or baseline_manifest.json: ${selectionLeaderboardPath}`,
    )
  }
  if (candidates.length === 1) {
    return candidates[0]
  }
  const matchingByLeaderboardSha = candidates.filter(
    (entry) =>
      String(entry?.payload?.selectionLeaderboardSha256 ?? "").trim() &&
      String(entry?.payload?.selectionLeaderboardSha256 ?? "").trim() === selectionLeaderboardSha256,
  )
  if (matchingByLeaderboardSha.length === 1) {
    return matchingByLeaderboardSha[0]
  }
  throw new Error(
    `selection-leaderboard matches multiple candidate manifests under ${baseDir}; resolve the ambiguity explicitly before freezing a curated subset.`,
  )
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const sourceCatalogPath = path.resolve(String(getFlag(parsed.flags, "source-catalog", "")).trim())
  const rawOutPath = String(getFlag(parsed.flags, "out-path", "")).trim()
  const rawRuleIdsPath = String(getFlag(parsed.flags, "rule-ids-file", "")).trim()
  const ruleIdsPath = rawRuleIdsPath ? path.resolve(rawRuleIdsPath) : null
  const requestedFamilyIds = uniqueSorted(
    String(getFlag(parsed.flags, "family-ids", ""))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const rawSelectionLeaderboardPath = String(getFlag(parsed.flags, "selection-leaderboard", "")).trim()
  const selectionLeaderboardPath = rawSelectionLeaderboardPath ? path.resolve(rawSelectionLeaderboardPath) : null
  if (!sourceCatalogPath) {
    throw new Error(
      "Usage: node tools/build_curated_perfect_prototype_catalog.mjs --source-catalog=<catalog.json> [--out-path=<catalog.json>] [--rule-ids=PP_x,PP_y] [--rule-ids-file=<ids.txt>] [--family-ids=<family_a,family_b>] [--selection-leaderboard=<selection_leaderboard.json>] [--selection-contract-id=<contract_id>] [--min-selection-open-oos-precision=<0..1>] [--min-selection-open-oos-hit-count=<n>] [--min-selection-open-oos-unique-matched-dates=<n>] [--min-selection-open-oos-close28-matched-rows=<n>] [--label=<label>] [--note=<note>] [--allow-mutable-output=true]",
    )
  }
  const sourceCatalog = await loadPerfectPrototypeCatalog(sourceCatalogPath)
  const sourceSurface = String(sourceCatalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()

  const ruleIdsFileRaw = ruleIdsPath ? await fs.readFile(ruleIdsPath, "utf8") : ""
  const explicitRuleIds = parseRuleIds({
    ruleIdsRaw: getFlag(parsed.flags, "rule-ids", ""),
    ruleIdsFileRaw,
  })
  if (explicitRuleIds.length < 1 && requestedFamilyIds.length < 1) {
    throw new Error("No selection provided. Provide --rule-ids/--rule-ids-file or --family-ids.")
  }
  if (requestedFamilyIds.length > 0 && !selectionLeaderboardPath) {
    throw new Error("--family-ids requires --selection-leaderboard so shadow subsets stay reproducible.")
  }

  const sourceRuleLookup = new Map(
    sourceCatalog.rules.map((rule) => [String(rule?.ruleId ?? "").trim(), rule]),
  )
  const missingRuleIds = explicitRuleIds.filter((ruleId) => !sourceRuleLookup.has(ruleId))
  if (missingRuleIds.length > 0) {
    throw new Error(`Selected rule IDs not found in source catalog: ${missingRuleIds.join(", ")}`)
  }

  const selectionLeaderboard = selectionLeaderboardPath
    ? JSON.parse(await fs.readFile(selectionLeaderboardPath, "utf8"))
    : null
  const selectionLeaderboardLookup = new Map(
    (Array.isArray(selectionLeaderboard) ? selectionLeaderboard : []).map((row) => [String(row?.ruleId ?? "").trim(), row]),
  )
  const selectionLeaderboardSha256 = selectionLeaderboardPath ? await computeFileSha256(selectionLeaderboardPath) : null
  const selectionManifestDetails = await resolveSelectionManifestDetails({
    selectionLeaderboardPath,
    selectionLeaderboardSha256,
  })
  const selectionManifest = selectionManifestDetails?.payload ?? null
  const minSelectionOpenOosPrecisionRaw = String(getFlag(parsed.flags, "min-selection-open-oos-precision", "")).trim()
  const minSelectionOpenOosHitCountRaw = String(getFlag(parsed.flags, "min-selection-open-oos-hit-count", "")).trim()
  const minSelectionOpenOosUniqueMatchedDatesRaw = String(
    getFlag(parsed.flags, "min-selection-open-oos-unique-matched-dates", ""),
  ).trim()
  const minSelectionOpenOosClose28MatchedRowsRaw = String(
    getFlag(parsed.flags, "min-selection-open-oos-close28-matched-rows", ""),
  ).trim()
  const minSelectionOpenOosPrecision = resolveMetricThreshold(minSelectionOpenOosPrecisionRaw, null)
  const minSelectionOpenOosHitCount = resolveMetricThreshold(minSelectionOpenOosHitCountRaw, null)
  const minSelectionOpenOosUniqueMatchedDates = resolveMetricThreshold(minSelectionOpenOosUniqueMatchedDatesRaw, null)
  const minSelectionOpenOosClose28MatchedRows = resolveMetricThreshold(minSelectionOpenOosClose28MatchedRowsRaw, null)
  const selectionIntent = String(
    getFlag(parsed.flags, "selection-intent", selectionLeaderboardPath ? "open_oos_selection" : "manual_curated_subset"),
  ).trim() || null
  const selectionProfileId = String(getFlag(parsed.flags, "selection-profile-id", "")).trim() || null
  const selectionProfileVersion = String(getFlag(parsed.flags, "selection-profile-version", "")).trim() || null
  const selectionMode = String(getFlag(parsed.flags, "selection-mode", "")).trim() || null
  const thresholdProfile = String(getFlag(parsed.flags, "threshold-profile", "")).trim() || null
  const manifestSurface =
    String(selectionManifest?.surface ?? selectionManifest?.selectionSurface ?? "").trim() || null
  const manifestLineId =
    String(selectionManifest?.lineId ?? selectionManifest?.selectionLineId ?? "").trim() || null
  const manifestTrainWindow = normalizeWindow(
    selectionManifest?.openTrainWindow ?? selectionManifest?.trainWindow ?? null,
  )
  const manifestOosWindow = normalizeWindow(
    selectionManifest?.openOosWindow ?? selectionManifest?.oosWindow ?? null,
  )
  const sourceCatalogSha256 =
    String(sourceCatalog?.freeze?.catalogContentSha256 ?? sourceCatalog?.metadata?.catalogContentSha256 ?? "").trim() ||
    null
  const sourceRuleIdsSha256 =
    String(sourceCatalog?.freeze?.ruleIdsSha256 ?? sourceCatalog?.metadata?.ruleIdsSha256 ?? "").trim() ||
    null
  if (selectionManifest) {
    const manifestCatalogSha256 = String(selectionManifest?.catalogContentSha256 ?? "").trim() || null
    const manifestRuleIdsSha256 = String(selectionManifest?.ruleIdsSha256 ?? "").trim() || null
    if (!manifestCatalogSha256 || !manifestRuleIdsSha256) {
      throw new Error(
        `selection manifest is missing frozen catalog hash fields: ${selectionManifestDetails?.manifestPath ?? "unknown"}`,
      )
    }
    if (
      (sourceCatalogSha256 && manifestCatalogSha256 !== sourceCatalogSha256) ||
      (sourceRuleIdsSha256 && manifestRuleIdsSha256 !== sourceRuleIdsSha256)
    ) {
      throw new Error(
        `selection manifest catalog hash mismatch for source-catalog=${sourceCatalogPath}; manifest=${selectionManifestDetails?.manifestPath ?? "unknown"}`,
      )
    }
    const manifestSelectionLeaderboardSha256 =
      String(selectionManifest?.selectionLeaderboardSha256 ?? "").trim() || null
    if (
      manifestSelectionLeaderboardSha256 &&
      selectionLeaderboardSha256 &&
      manifestSelectionLeaderboardSha256 !== selectionLeaderboardSha256
    ) {
      throw new Error(
        `selection leaderboard hash mismatch: leaderboard=${selectionLeaderboardPath} manifest=${selectionManifestDetails?.manifestPath ?? "unknown"}`,
      )
    }
    if (manifestSurface && sourceSurface && manifestSurface.toLowerCase() !== sourceSurface.toLowerCase()) {
      throw new Error(
        `selection manifest surface=${manifestSurface} does not match source catalog surface=${sourceSurface}`,
      )
    }
  }
  const requestedSelectionLineId = String(getFlag(parsed.flags, "selection-line-id", "")).trim() || null
  const requestedSelectionContractId = String(getFlag(parsed.flags, "selection-contract-id", "")).trim() || null
  if (requestedSelectionLineId && manifestLineId && requestedSelectionLineId !== manifestLineId) {
    throw new Error(
      `selection-line-id=${requestedSelectionLineId} does not match selection manifest lineId=${manifestLineId}`,
    )
  }
  const selectionLineId = requestedSelectionLineId ?? manifestLineId ?? null
  const isRecentOnlySelectionLine = selectionLineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID
  const requestedRecentOnlyFamilyIds = buildPerfectPrototypeRecentOnlyShadowFamilyIdSet(requestedFamilyIds)
  const requestedLowBundleFamilyIds = buildPerfectPrototypeRecentLowBundleFamilyIdSet(requestedFamilyIds)
  const sourceDiscoveryUniverseId =
    String(sourceCatalog?.metadata?.datasetContract?.discoveryUniverseId ?? "").trim() || null
  if (
    requestedSelectionContractId &&
    !PERFECT_PROTOTYPE_RECENT_ONLY_ALLOWED_CONTRACT_IDS.has(requestedSelectionContractId)
  ) {
    throw new Error(`Unsupported selection-contract-id: ${requestedSelectionContractId}`)
  }
  const selectionContractId =
    requestedSelectionContractId ?? (isRecentOnlySelectionLine ? PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_CONTRACT_ID : null)
  const isRecentOnlyLowBundleSelectionContract =
    selectionContractId === PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID
  const isHaesungLowGapTopOos100SelectionContract =
    selectionContractId === PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID
  const hasExplicitPerRuleSelectionThreshold =
    !!minSelectionOpenOosPrecisionRaw ||
    !!minSelectionOpenOosHitCountRaw ||
    !!minSelectionOpenOosUniqueMatchedDatesRaw ||
    !!minSelectionOpenOosClose28MatchedRowsRaw
  if (requestedRecentOnlyFamilyIds.size > 0 && selectionLineId !== PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID) {
    throw new Error(
      `recent-only MID/LOW family selection requires selectionLineId=${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID}`,
    )
  }
  if (requestedRecentOnlyFamilyIds.size > 0 && !selectionManifest) {
    throw new Error("recent-only MID/LOW family selection requires a selection manifest with line/window provenance.")
  }
  if (isRecentOnlySelectionLine) {
    if (!selectionManifest) {
      throw new Error("recent-only MID/LOW shadow freeze requires a selection manifest with line/window provenance.")
    }
    if (explicitRuleIds.length > 0) {
      throw new Error(
        "recent-only MID/LOW shadow freeze forbids explicit --rule-ids/--rule-ids-file; use --family-ids with a selection leaderboard.",
      )
    }
    if (requestedFamilyIds.length < 1) {
      throw new Error("recent-only MID/LOW shadow freeze requires --family-ids.")
    }
    if (requestedRecentOnlyFamilyIds.size !== requestedFamilyIds.length) {
      throw new Error(
        [
          "recent-only MID/LOW shadow freeze only allows family-ids:",
          PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.join(", "),
        ].join(" "),
      )
    }
    if (sourceDiscoveryUniverseId !== PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID) {
      throw new Error(
        `recent-only MID/LOW shadow freeze requires source discoveryUniverseId=${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID}, got ${sourceDiscoveryUniverseId ?? "null"}`,
      )
    }
  }
  if (isRecentOnlyLowBundleSelectionContract) {
    if (!isRecentOnlySelectionLine) {
      throw new Error(
        `${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} requires selectionLineId=${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID}`,
      )
    }
    if (requestedFamilyIds.length < 1 || requestedLowBundleFamilyIds.size !== requestedFamilyIds.length) {
      throw new Error(
        [
          `${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} only allows family-ids:`,
          PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.join(", "),
        ].join(" "),
      )
    }
    if (
      hasExplicitPerRuleSelectionThreshold
    ) {
      throw new Error(
        `${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} uses bundle-level thresholds only; omit per-rule --min-selection-open-oos-* flags.`,
      )
    }
  }
  if (isHaesungLowGapTopOos100SelectionContract) {
    if (!isRecentOnlySelectionLine) {
      throw new Error(
        `${PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID} requires selectionLineId=${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID}`,
      )
    }
    if (
      requestedFamilyIds.length !== 1 ||
      requestedFamilyIds[0] !== PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION
    ) {
      throw new Error(
        `${PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID} only allows --family-ids=${PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION}`,
      )
    }
    if (!selectionManifest) {
      throw new Error(
        `${PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID} requires a selection manifest with support-case provenance.`,
      )
    }
    const manifestSupportCaseIds = uniqueSorted(selectionManifest?.supportCaseIds)
    if (!manifestSupportCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
      throw new Error(
        `${PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID} requires supportCaseIds to include ${PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID}`,
      )
    }
  }
  const effectiveMinSelectionOpenOosClose28MatchedRows =
    minSelectionOpenOosClose28MatchedRows != null
      ? minSelectionOpenOosClose28MatchedRows
      : requestedFamilyIds.length > 0 && !isRecentOnlyLowBundleSelectionContract
        ? 1
        : null
  const requestedSelectionSurface = String(
    getFlag(parsed.flags, "selection-surface", manifestSurface || sourceSurface || ""),
  ).trim() || null
  if (
    requestedSelectionSurface &&
    manifestSurface &&
    requestedSelectionSurface.toLowerCase() !== manifestSurface.toLowerCase()
  ) {
    throw new Error(
      `selection-surface=${requestedSelectionSurface} does not match selection manifest surface=${manifestSurface}`,
    )
  }
  const selectionSurface = requestedSelectionSurface ?? manifestSurface ?? sourceSurface ?? null
  if (
    isRecentOnlySelectionLine &&
    String(selectionSurface ?? "").trim().toLowerCase() !==
      PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE.toLowerCase()
  ) {
    throw new Error(
      `recent-only MID/LOW shadow freeze requires selectionSurface=${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE}, got ${selectionSurface ?? "null"}`,
    )
  }
  const requestedSelectionTrainWindow = {
    start: String(getFlag(parsed.flags, "selection-train-start", "")).trim() || null,
    end: String(getFlag(parsed.flags, "selection-train-end", "")).trim() || null,
  }
  const requestedSelectionOosWindow = {
    start: String(getFlag(parsed.flags, "selection-oos-start", "")).trim() || null,
    end: String(getFlag(parsed.flags, "selection-oos-end", "")).trim() || null,
  }
  if (
    (requestedSelectionTrainWindow.start || requestedSelectionTrainWindow.end) &&
    manifestTrainWindow &&
    !windowsEqual(requestedSelectionTrainWindow, manifestTrainWindow)
  ) {
    throw new Error(
      `selection-train window does not match selection manifest window for ${selectionManifestDetails?.manifestPath ?? "unknown"}`,
    )
  }
  if (
    (requestedSelectionOosWindow.start || requestedSelectionOosWindow.end) &&
    manifestOosWindow &&
    !windowsEqual(requestedSelectionOosWindow, manifestOosWindow)
  ) {
    throw new Error(
      `selection-oos window does not match selection manifest window for ${selectionManifestDetails?.manifestPath ?? "unknown"}`,
    )
  }
  const selectionTrainWindow =
    requestedSelectionTrainWindow.start || requestedSelectionTrainWindow.end
      ? normalizeWindow(requestedSelectionTrainWindow)
      : manifestTrainWindow
  const selectionOosWindow =
    requestedSelectionOosWindow.start || requestedSelectionOosWindow.end
      ? normalizeWindow(requestedSelectionOosWindow)
      : manifestOosWindow
  const freezeRejectCountByFamily = {}
  const freezeRejectReasonByFamily = {}
  let selectionBundle = null
  const recordFreezeRejectFamily = (familyId, reason) => {
    const normalizedFamilyId = String(familyId ?? "unclassified").trim() || "unclassified"
    freezeRejectCountByFamily[normalizedFamilyId] = Number(freezeRejectCountByFamily[normalizedFamilyId] ?? 0) + 1
    const reasonBucket = freezeRejectReasonByFamily[normalizedFamilyId] ?? {}
    reasonBucket[reason] = Number(reasonBucket[reason] ?? 0) + 1
    freezeRejectReasonByFamily[normalizedFamilyId] = reasonBucket
  }
  const recordFreezeReject = (ruleId, reason) => {
    const familyId = String(sourceRuleLookup.get(ruleId)?.familyId ?? "unclassified").trim() || "unclassified"
    recordFreezeRejectFamily(familyId, reason)
  }
  const selectedFamilyRules =
    requestedFamilyIds.length > 0
      ? resolvePerfectPrototypeRuleFamilySelection({
          familyIds: requestedFamilyIds,
          rules: sourceCatalog.rules,
        }).rules
      : []
  const familySelectedRuleIds = selectedFamilyRules
    .map((rule) => String(rule?.ruleId ?? "").trim())
    .filter(Boolean)
  let familyFilteredRuleIds = []
  if (requestedFamilyIds.length > 0 && isRecentOnlyLowBundleSelectionContract) {
    const missingSelectionRuleIds = familySelectedRuleIds.filter((ruleId) => !selectionLeaderboardLookup.has(ruleId))
    if (missingSelectionRuleIds.length > 0) {
      throw new Error(
        `LOW bundle contract requires selection leaderboard coverage for every candidate rule; missing: ${missingSelectionRuleIds.join(", ")}`,
      )
    }
    const close28Dir = path.resolve(String(selectionManifest?.oosApplyClose28Dir ?? "").trim())
    if (!close28Dir) {
      throw new Error(`${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} requires selectionManifest.oosApplyClose28Dir`)
    }
    const close28DedupedPath = path.join(close28Dir, "deduped_symbols.jsonl")
    if (!pathExists(close28DedupedPath)) {
      throw new Error(
        `${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} requires ${close28DedupedPath}`,
      )
    }
    const close28DedupedRows = await readJsonl(close28DedupedPath)
    selectionBundle = selectRecentLowShadowBundleCandidate({
      rows: close28DedupedRows,
      candidateRuleIds: familySelectedRuleIds,
    })
    if (!selectionBundle.promotable || selectionBundle.selectedRuleIds.length < 1) {
      for (const familyId of requestedFamilyIds) {
        for (const reason of selectionBundle.rejectReasons) {
          recordFreezeRejectFamily(familyId, reason)
        }
      }
      throw new Error(
        [
          `${PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID} did not produce a promotable LOW bundle candidate.`,
          `rejectReasons=${selectionBundle.rejectReasons.join(",") || "none"}`,
          `selectedRows=${selectionBundle.metrics?.selectedRows ?? 0}`,
          `hitRows=${selectionBundle.metrics?.hitRows ?? 0}`,
          `uniqueDates=${selectionBundle.metrics?.uniqueDateCount ?? 0}`,
          `hitRate=${selectionBundle.metrics?.hitRate ?? 0}`,
        ].join(" "),
      )
    }
    familyFilteredRuleIds = selectionBundle.selectedRuleIds
  } else {
    familyFilteredRuleIds =
      requestedFamilyIds.length > 0
        ? familySelectedRuleIds.filter((ruleId) => {
            if (!selectionLeaderboardPath) return true
            const selection = selectionLeaderboardLookup.get(ruleId)
            if (!selection) {
              recordFreezeReject(ruleId, "selection_missing")
              return false
            }
            if (
              minSelectionOpenOosPrecision != null &&
              Number(selection?.openOosPrecision ?? 0) < Number(minSelectionOpenOosPrecision)
            ) {
              recordFreezeReject(ruleId, "open_oos_precision_below_threshold")
              return false
            }
            if (
              minSelectionOpenOosHitCount != null &&
              Number(selection?.openOosHitCount ?? 0) < Number(minSelectionOpenOosHitCount)
            ) {
              recordFreezeReject(ruleId, "open_oos_hit_count_below_threshold")
              return false
            }
            if (
              minSelectionOpenOosUniqueMatchedDates != null &&
              Number(selection?.openOosUniqueMatchedDates ?? 0) < Number(minSelectionOpenOosUniqueMatchedDates)
            ) {
              recordFreezeReject(ruleId, "open_oos_unique_dates_below_threshold")
              return false
            }
            if (
              effectiveMinSelectionOpenOosClose28MatchedRows != null &&
              Number(selection?.openOosClose28MatchedRows ?? 0) <
                Number(effectiveMinSelectionOpenOosClose28MatchedRows)
            ) {
              recordFreezeReject(ruleId, "open_oos_close28_rows_below_threshold")
              return false
            }
            if (isHaesungLowGapTopOos100SelectionContract) {
              if (Number(selection?.openOosPrecision ?? 0) < 1) {
                recordFreezeReject(ruleId, "haesung_oos_precision_not_perfect")
                return false
              }
              if (Number(selection?.openOosMatchCount ?? 0) < 3) {
                recordFreezeReject(ruleId, "haesung_oos_match_count_below_threshold")
                return false
              }
              if (Number(selection?.openOosUniqueMatchedDates ?? 0) < 3) {
                recordFreezeReject(ruleId, "haesung_oos_unique_dates_below_threshold")
                return false
              }
              if (Number(selection?.trainMatchedMonthCount ?? 0) < 4) {
                recordFreezeReject(ruleId, "haesung_train_month_breadth_below_threshold")
                return false
              }
              if (Number(selection?.trainMatchedFoldCount ?? 0) < 4) {
                recordFreezeReject(ruleId, "haesung_train_fold_breadth_below_threshold")
                return false
              }
              if (selection?.haesungSupport !== true) {
                recordFreezeReject(ruleId, "haesung_support_missing")
                return false
              }
            }
            return true
          })
        : []
  }
  const effectiveSelectionAllowedFamilyIds = requestedFamilyIds.length > 0 ? requestedFamilyIds : []
  if (isRecentOnlySelectionLine && effectiveSelectionAllowedFamilyIds.length < 1) {
    throw new Error("recent-only MID/LOW shadow freeze requires non-empty selectionAllowedFamilyIds.")
  }
  const selectedRuleIds = uniqueSorted([...explicitRuleIds, ...familyFilteredRuleIds])
  if (selectedRuleIds.length < 1) {
    throw new Error(
      "Curated selection resolved to zero rules after applying family filters and leaderboard thresholds.",
    )
  }
  if (isRecentOnlySelectionLine) {
    const selectedRuleFamilyViolations = selectedRuleIds.filter((ruleId) => {
      const familyId = String(sourceRuleLookup.get(ruleId)?.familyId ?? "").trim()
      return !requestedRecentOnlyFamilyIds.has(familyId)
    })
    if (selectedRuleFamilyViolations.length > 0) {
      throw new Error(
        `recent-only MID/LOW shadow freeze selected rules outside allowed families: ${selectedRuleFamilyViolations.join(", ")}`,
      )
    }
  }

  const rankedRules = rankPerfectPrototypeRules(selectedRuleIds.map((ruleId) => sourceRuleLookup.get(ruleId)))
    .map((rule) => {
      const selection = selectionLeaderboardLookup.get(String(rule?.ruleId ?? "").trim()) ?? null
      if (!selection) return rule
      return {
        ...rule,
        selectionRank: Number(selection?.selectionRank ?? 0) || null,
        selectionOpenTrainMatchCount: Number(selection?.openTrainMatchCount ?? 0) || 0,
        selectionOpenTrainHitCount: Number(selection?.openTrainHitCount ?? 0) || 0,
        selectionOpenTrainNegativeCount: Number(selection?.openTrainNegativeCount ?? 0) || 0,
        selectionOpenTrainPrecision: Number(selection?.openTrainPrecision ?? 0) || 0,
        selectionOpenOosMatchCount: Number(selection?.openOosMatchCount ?? 0) || 0,
        selectionOpenOosHitCount: Number(selection?.openOosHitCount ?? 0) || 0,
        selectionOpenOosNegativeCount: Number(selection?.openOosNegativeCount ?? 0) || 0,
        selectionOpenOosPrecision: Number(selection?.openOosPrecision ?? 0) || 0,
        selectionOpenOosUniqueMatchedDates: Number(selection?.openOosUniqueMatchedDates ?? 0) || 0,
        selectionOpenOosUniqueMatchedSymbols: Number(selection?.openOosUniqueMatchedSymbols ?? 0) || 0,
        selectionOpenOosClose28MatchedRows: Number(selection?.openOosClose28MatchedRows ?? 0) || 0,
        selectionTrainMatchedMonthCount: Number(selection?.trainMatchedMonthCount ?? 0) || 0,
        selectionTrainMatchedFoldCount: Number(selection?.trainMatchedFoldCount ?? 0) || 0,
        selectionSupportCaseIds: Array.isArray(selection?.supportCaseIds)
          ? uniqueSorted(selection.supportCaseIds)
          : [],
        selectionHaesungSupport: selection?.haesungSupport === true,
      }
    })
  const champion = pickChampionPerfectPrototypeRule(rankedRules)
  const label = String(getFlag(parsed.flags, "label", "curated_manual")).trim() || "curated_manual"
  const note = String(getFlag(parsed.flags, "note", "")).trim()
  const allowMutableOutput = String(getFlag(parsed.flags, "allow-mutable-output", "")).trim().toLowerCase() === "true"
  const outPath = path.resolve(
    rawOutPath ||
      buildDefaultPerfectPrototypeFrozenCatalogPath({
        cwd: process.cwd(),
        sourceCatalogPath,
        sourceCatalog,
        sourceSurface,
        ruleIds: selectedRuleIds,
        selectionLeaderboardSha256,
        selectionProfileId,
      }),
  )
  assertPerfectPrototypeFrozenCatalogOutputPath({
    outPath,
    allowMutableOutput,
    sourceSurface,
  })

  const curatedCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
    version: 1,
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceCatalogPath,
      sourceRuleCount: Array.isArray(sourceCatalog.rules) ? sourceCatalog.rules.length : 0,
      sourceCatalogMetadata: sourceCatalog.metadata ?? null,
      datasetContract: sourceCatalog?.metadata?.datasetContract ?? null,
      sourceCatalogChampionRuleId: sourceCatalog?.champion?.ruleId ?? null,
      sourceRuleLevelSet: uniqueSorted(
        (Array.isArray(sourceCatalog.rules) ? sourceCatalog.rules : []).map((rule) => rule?.ruleLevel ?? null),
      ),
      curatedRuleCount: rankedRules.length,
      curatedLabel: label,
      curatedNote: note || null,
      curatedRuleIds: selectedRuleIds,
      curatedFamilyIds: requestedFamilyIds,
      selectionAllowedFamilyIds: effectiveSelectionAllowedFamilyIds,
      selectionContractId: isRecentOnlySelectionLine ? selectionContractId : null,
      selectionDiscoveryUniverseId:
        String(sourceCatalog?.metadata?.datasetContract?.discoveryUniverseId ?? "").trim() || null,
      sourceRunId: sourceCatalog?.freeze?.sourceRunId ?? null,
      selectionModeIntent: selectionIntent ?? "manual_curated_subset",
      selectionIntent,
      selectionProfileId,
      selectionLeaderboardSha256,
      selectionManifestPath: selectionManifestDetails?.manifestPath ?? null,
      selectionManifestSha256: selectionManifestDetails?.manifestSha256 ?? null,
      selectionManifestKind: selectionManifest
        ? path.basename(String(selectionManifestDetails?.manifestPath ?? ""))
        : null,
      selectionBundleRuleIds: selectionBundle?.selectedRuleIds ?? [],
      selectionBundleMetrics: selectionBundle?.metrics ?? null,
      selectionBundlePromotable: selectionBundle?.promotable ?? null,
      selectionBundleRejectReasons: selectionBundle?.rejectReasons ?? [],
      selectionRequiredSupportCaseIds: isHaesungLowGapTopOos100SelectionContract
        ? [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID]
        : [],
      freezeRejectCountByFamily,
      freezeRejectReasonByFamily,
      selectionProfileVersion,
      selectionTrainWindow:
        selectionTrainWindow?.start || selectionTrainWindow?.end ? selectionTrainWindow : null,
      selectionOosWindow:
        selectionOosWindow?.start || selectionOosWindow?.end ? selectionOosWindow : null,
      selectionLineId,
      selectionSurface,
      selectionMode,
      thresholdProfile,
      minSelectionOpenOosPrecision,
      minSelectionOpenOosHitCount,
      minSelectionOpenOosUniqueMatchedDates,
      minSelectionOpenOosClose28MatchedRows: effectiveMinSelectionOpenOosClose28MatchedRows,
    },
    tokenizerSpec: sourceCatalog.tokenizerSpec ?? null,
    champion,
    summary: {
      curatedRuleCount: rankedRules.length,
      curatedRuleIds: selectedRuleIds,
      curatedFamilyIds: requestedFamilyIds,
      selectionAllowedFamilyIds: effectiveSelectionAllowedFamilyIds,
      selectionBundleRuleIds: selectionBundle?.selectedRuleIds ?? [],
      selectionBundleMetrics: selectionBundle?.metrics ?? null,
      selectionBundlePromotable: selectionBundle?.promotable ?? null,
      selectionBundleRejectReasons: selectionBundle?.rejectReasons ?? [],
      selectionRequiredSupportCaseIds: isHaesungLowGapTopOos100SelectionContract
        ? [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID]
        : [],
      freezeRejectCountByFamily,
      freezeRejectReasonByFamily,
    },
    rules: rankedRules,
    },
    sourceCatalog,
    sourceCatalogPath,
    sourceRunId: sourceCatalog?.freeze?.sourceRunId ?? null,
    selectionModeIntent: selectionIntent ?? "manual_curated_subset",
    selectionIntent,
    selectionProfileId,
    selectionLeaderboardSha256,
    selectionBaselineManifestSha256: selectionManifestDetails?.manifestSha256 ?? null,
    selectionProfileVersion,
    selectionTrainWindow:
      selectionTrainWindow?.start || selectionTrainWindow?.end ? selectionTrainWindow : null,
    selectionOosWindow:
      selectionOosWindow?.start || selectionOosWindow?.end ? selectionOosWindow : null,
    selectionLineId,
    selectionSurface,
    selectionMode,
    thresholdProfile,
    minSelectionOpenOosPrecision,
    minSelectionOpenOosHitCount,
    minSelectionOpenOosUniqueMatchedDates,
    minSelectionOpenOosClose28MatchedRows: effectiveMinSelectionOpenOosClose28MatchedRows,
  })
  const manifest = buildPerfectPrototypeCatalogManifest({
    catalog: curatedCatalog,
    catalogPath: outPath,
    sourceCatalogPath,
  })
  const manifestPath = resolvePerfectPrototypeCatalogManifestPath(outPath)

  if (pathExists(outPath) || pathExists(manifestPath)) {
    if (!pathExists(outPath) || !pathExists(manifestPath)) {
      throw new Error(
        [
          "Frozen curated catalog path already exists in a partial state.",
          `catalog=${outPath}`,
          `manifest=${manifestPath}`,
          "Repair or remove the incomplete artifact explicitly before rebuilding.",
        ].join(" "),
      )
    }
    const existingCatalog = await loadPerfectPrototypeCatalog(outPath, { requireFrozen: true })
    const existingCatalogSha = String(existingCatalog?.freeze?.catalogContentSha256 ?? "").trim()
    const existingRuleIdsSha = String(existingCatalog?.freeze?.ruleIdsSha256 ?? "").trim()
    const nextCatalogSha = String(curatedCatalog?.metadata?.catalogContentSha256 ?? "").trim()
    const nextRuleIdsSha = String(curatedCatalog?.metadata?.ruleIdsSha256 ?? "").trim()
    if (existingCatalogSha === nextCatalogSha && existingRuleIdsSha === nextRuleIdsSha) {
      let existingManifest = null
      try {
        existingManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
      } catch (error) {
        throw new Error(
          [
            "Frozen curated catalog manifest is unreadable for an existing immutable artifact.",
            `manifest=${manifestPath}`,
            error instanceof Error ? error.message : String(error),
          ].join(" "),
        )
      }
      const manifestCatalogSha = String(existingManifest?.catalogContentSha256 ?? "").trim()
      const manifestRuleIdsSha = String(existingManifest?.ruleIdsSha256 ?? "").trim()
      const manifestCatalogPath = path.resolve(String(existingManifest?.catalogPath ?? "").trim())
      if (
        manifestCatalogSha !== nextCatalogSha ||
        manifestRuleIdsSha !== nextRuleIdsSha ||
        manifestCatalogPath !== outPath
      ) {
        throw new Error(
          [
            "Existing frozen curated catalog manifest does not match the immutable catalog artifact.",
            `catalog=${outPath}`,
            `manifest=${manifestPath}`,
            "Repair the frozen artifact explicitly instead of silently reusing it.",
          ].join(" "),
        )
      }
      console.log(
        JSON.stringify(
          {
            outPath,
            manifestPath,
            curatedRuleCount: rankedRules.length,
            championRuleId: champion?.ruleId ?? null,
            curatedRuleIds: selectedRuleIds,
            curatedFamilyIds: requestedFamilyIds,
            selectionContractId: isRecentOnlySelectionLine ? selectionContractId : null,
            selectionBundleRuleIds: selectionBundle?.selectedRuleIds ?? [],
            selectionBundleMetrics: selectionBundle?.metrics ?? null,
            selectionBundlePromotable: selectionBundle?.promotable ?? null,
            selectionBundleRejectReasons: selectionBundle?.rejectReasons ?? [],
            catalogContentSha256: nextCatalogSha,
            ruleIdsSha256: nextRuleIdsSha,
            reusedExisting: true,
          },
          null,
          2,
        ),
      )
      return
    }
    throw new Error(
      [
        "Frozen curated catalog path already exists with different content.",
        `catalog=${outPath}`,
        `existingCatalogSha256=${existingCatalogSha || "unknown"}`,
        `newCatalogSha256=${nextCatalogSha || "unknown"}`,
        "Choose a new immutable output path instead of overwriting the existing frozen artifact.",
      ].join(" "),
    )
  }

  await ensureDir(path.dirname(outPath))
  await writeJson(outPath, curatedCatalog)
  await writeJson(manifestPath, manifest)
  console.log(
    JSON.stringify(
      {
        outPath,
        manifestPath,
        curatedRuleCount: rankedRules.length,
        championRuleId: champion?.ruleId ?? null,
        curatedRuleIds: selectedRuleIds,
        curatedFamilyIds: requestedFamilyIds,
        selectionContractId: isRecentOnlySelectionLine ? selectionContractId : null,
        selectionBundleRuleIds: selectionBundle?.selectedRuleIds ?? [],
        selectionBundleMetrics: selectionBundle?.metrics ?? null,
        selectionBundlePromotable: selectionBundle?.promotable ?? null,
        selectionBundleRejectReasons: selectionBundle?.rejectReasons ?? [],
        catalogContentSha256: curatedCatalog?.metadata?.catalogContentSha256 ?? null,
        ruleIdsSha256: curatedCatalog?.metadata?.ruleIdsSha256 ?? null,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
