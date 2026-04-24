import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  ensureDir,
  readJson,
  readJsonl,
  writeJson,
} from "../src/lib/io.mjs"
import { solvePerfectPrototypeDecisionSet } from "../src/lib/perfect_prototype_decision_set_solver.mjs"
import { buildPerfectPrototypeStableRuleBank } from "../src/lib/perfect_prototype_stable_rule_bank.mjs"
import { normalizePerfectPrototypeSupportCases } from "../src/lib/perfect_prototype_support_case.mjs"

const toInteger = (value, fallback) => {
  const numeric = Math.floor(Number(value))
  return Number.isInteger(numeric) ? numeric : fallback
}

const toNumber = (value, fallback) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const leaderboardPath = path.resolve(String(getFlag(parsed.flags, "leaderboard", "")).trim())
  const trainInputPath = path.resolve(String(getFlag(parsed.flags, "train-input", "")).trim())
  const oosInputPath = path.resolve(String(getFlag(parsed.flags, "oos-input", "")).trim())
  const supportCasesFile = path.resolve(
    String(getFlag(parsed.flags, "support-cases-file", "")).trim(),
  )
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const familyId =
    String(getFlag(parsed.flags, "family-id", "low_gap_top_continuation")).trim() ||
    "low_gap_top_continuation"
  if (
    !catalogPath ||
    !leaderboardPath ||
    !trainInputPath ||
    !oosInputPath ||
    !supportCasesFile ||
    !outDir
  ) {
    throw new Error(
      "Usage: node tools/solve_perfect_prototype_low_gap_top_decision_set.mjs --catalog=<catalog.json> --leaderboard=<selection_leaderboard.json> --train-input=<daily_pack.jsonl> --oos-input=<daily_pack.jsonl> --support-cases-file=<support_cases.json> --out-dir=<dir> [--family-id=low_gap_top_continuation] [--candidate-limit=48] [--max-clauses=3]",
    )
  }

  await ensureDir(outDir)
  const catalog = await loadPerfectPrototypeCatalog(catalogPath, { requireFrozen: true })
  const selectionLeaderboard = await readJson(leaderboardPath, [])
  const trainRows = await readJsonl(trainInputPath)
  const oosRows = await readJsonl(oosInputPath)
  const supportCasesPayload = await readJson(supportCasesFile, null)
  const supportCases = normalizePerfectPrototypeSupportCases(
    Array.isArray(supportCasesPayload?.supportCases)
      ? supportCasesPayload.supportCases
      : Array.isArray(supportCasesPayload?.cases)
        ? supportCasesPayload.cases
        : [],
  )
  if (supportCases.length < 1) {
    throw new Error(`support-cases-file resolved zero support cases: ${supportCasesFile}`)
  }

  const candidateClauses = buildPerfectPrototypeStableRuleBank({
    catalog,
    selectionLeaderboard,
    trainRows,
    oosRows,
    supportCases,
    familyId,
    surfaceName:
      String(
        getFlag(
          parsed.flags,
          "surface-name",
          supportCasesPayload?.tokenizerSurface ?? catalog?.metadata?.surfaceName ?? "",
        ),
      ).trim() || null,
    tokenizerOptions: {
      ...(supportCasesPayload?.tokenizerOptionsOverride &&
      typeof supportCasesPayload.tokenizerOptionsOverride === "object"
        ? supportCasesPayload.tokenizerOptionsOverride
        : {}),
      enableSupportMetricFeatures: true,
      enableSupportManifoldSignature: true,
      enableAdaptiveThresholdAtoms: true,
      enableIntervalAtoms: true,
      enableMacroAtoms: true,
      enableSupportAnchorAtoms: true,
    },
    candidateLimit: toInteger(getFlag(parsed.flags, "candidate-limit", 48), 48),
    minTrainMatchedDates: toInteger(getFlag(parsed.flags, "min-clause-train-dates", 3), 3),
    minTrainMatchedMonths: toInteger(getFlag(parsed.flags, "min-clause-train-months", 3), 3),
    minTrainMatchedFolds: toInteger(getFlag(parsed.flags, "min-clause-train-folds", 1), 1),
    maxCrossfitNegativeWindows: toInteger(
      getFlag(parsed.flags, "max-clause-crossfit-negative-windows", 0),
      0,
    ),
    minCrossfitPositiveWindows: toInteger(
      getFlag(parsed.flags, "min-clause-crossfit-positive-windows", 1),
      1,
    ),
    crossfitWindowCount: toInteger(getFlag(parsed.flags, "crossfit-window-count", 6), 6),
    crossfitFoldCount: toInteger(getFlag(parsed.flags, "crossfit-fold-count", 4), 4),
    crossfitMinWindowSupport: toInteger(
      getFlag(parsed.flags, "crossfit-min-window-support", 2),
      2,
    ),
    maxClauseSize: toInteger(getFlag(parsed.flags, "max-clause-size", 3), 3),
    supportTokenLimit: toInteger(getFlag(parsed.flags, "support-token-limit", 14), 14),
    generalTokenLimit: toInteger(getFlag(parsed.flags, "general-token-limit", 20), 20),
  })

  await writeJson(path.join(outDir, "stable_clause_bank.json"), candidateClauses)

  const solution = solvePerfectPrototypeDecisionSet({
    candidateClauses,
    maxClauses: toInteger(getFlag(parsed.flags, "max-clauses", 3), 3),
    minTrainMatchedDates: toInteger(getFlag(parsed.flags, "min-train-dates", 10), 10),
    minTrainMatchedMonths: toInteger(getFlag(parsed.flags, "min-train-months", 6), 6),
    minTrainMatchedFolds: toInteger(getFlag(parsed.flags, "min-train-folds", 4), 4),
    maxCrossfitNegativeWindows: toInteger(
      getFlag(parsed.flags, "max-crossfit-negative-windows", 0),
      0,
    ),
    minCrossfitPositiveWindows: toInteger(
      getFlag(parsed.flags, "min-crossfit-positive-windows", 2),
      2,
    ),
    minOpenOosPrecision: toNumber(getFlag(parsed.flags, "min-oos-precision", 1), 1),
    minOpenOosMatchCount: toInteger(getFlag(parsed.flags, "min-oos-match-count", 3), 3),
    minOpenOosUniqueMatchedDates: toInteger(
      getFlag(parsed.flags, "min-oos-unique-dates", 3),
      3,
    ),
  })

  const summary = {
    ...solution,
    familyId,
    catalogPath,
    leaderboardPath,
    trainInputPath,
    oosInputPath,
    supportCasesFile,
    stableClauseCandidateCount: candidateClauses.length,
  }
  if (solution.ok) {
    await writeJson(path.join(outDir, "decision_set_summary.json"), summary)
    await writeJson(
      path.join(outDir, "decision_set_selected_clauses.json"),
      candidateClauses.filter((clause) => solution.ruleIds.includes(clause.ruleId)),
    )
  } else {
    await writeJson(path.join(outDir, "no_decision_set_summary.json"), summary)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
