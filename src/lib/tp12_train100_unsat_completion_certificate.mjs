import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir } from "./io.mjs"
import {
  loadTp12Train100UnsatCompletionContract,
  outputPathFromContract,
  readJsonRequired,
  toNumber,
  toText,
  writeSummary,
} from "./tp12_train100_unsat_completion_common.mjs"

const safeSummary = async (cwd, filePath, label, { optional = false } = {}) => {
  const text = toText(filePath)
  if (!text) {
    if (optional) return { path: null, payload: null }
    throw new Error(`${label} path is required`)
  }
  return readJsonRequired(cwd, text, label)
}

const numeric = (payload, keys, fallback = 0) => {
  for (const key of keys) {
    const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), payload)
    const parsed = toNumber(value, NaN)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const buildConclusion = ({ partitionStatus, survivorSummary }) => {
  const verifiedSurvivorCount = Math.max(0, Math.trunc(toNumber(survivorSummary?.verifiedSurvivorCount, 0)))
  const acceptedCandidateCount = Math.max(0, Math.trunc(toNumber(partitionStatus?.acceptedCandidateCount, 0)))
  const remainingFrontierSize = Math.max(0, Math.trunc(toNumber(partitionStatus?.remainingFrontierSize, 0)))
  if (verifiedSurvivorCount > 0 || acceptedCandidateCount > 0) {
    return {
      code: "survivor_found_in_completion_scope",
      existenceResolved: true,
      absenceProvenInScope: false,
      message: "At least one declared train100 year2hit survivor was verified or reported by completed partition search.",
    }
  }
  if (partitionStatus?.status === "blocked_missing_frontier_source") {
    return {
      code: "completion_blocked_missing_frontier_source",
      existenceResolved: false,
      absenceProvenInScope: false,
      message: "No survivor was verified, but the unresolved frontier source checkpoint/sidecar is missing, so global existence remains unresolved.",
    }
  }
  if (partitionStatus?.searchComplete === true && remainingFrontierSize === 0) {
    return {
      code: "absence_proven_in_completion_scope",
      existenceResolved: true,
      absenceProvenInScope: true,
      message: "The declared completion scope is fully searched, no frontier remains, and no train100 year2hit survivor was verified.",
    }
  }
  return {
    code: "no_survivor_found_but_completion_scope_incomplete",
    existenceResolved: false,
    absenceProvenInScope: false,
    message: "No survivor was verified, but the declared completion scope is incomplete, so global existence remains unresolved.",
  }
}

const writeMarkdownReport = async ({ outReportPath, summary }) => {
  if (!toText(outReportPath)) return
  await ensureDir(path.dirname(outReportPath))
  const lines = [
    "# TP12 Train100 Year2Hit Unsat Completion Certificate",
    "",
    `- patchKey: \`${summary.patchKey}\``,
    `- status: \`${summary.status}\``,
    `- conclusion: \`${summary.conclusion.code}\``,
    `- existenceResolved: \`${summary.conclusion.existenceResolved}\``,
    `- absenceProvenInScope: \`${summary.conclusion.absenceProvenInScope}\``,
    `- oosRead: \`${summary.oosRead}\``,
    `- lockedSelectorEmitted: \`${summary.lockedSelectorEmitted}\``,
    "",
    "## Target",
    "",
    `- trainDateRange: \`${summary.trainDateRange.from}..${summary.trainDateRange.to}\``,
    `- requiredTrainPrecision: \`${summary.target.requiredTrainPrecision}\``,
    `- maxFalsePositiveRows: \`${summary.target.maxFalsePositiveRows}\``,
    `- minHitDecisionDatesPerYear: \`${summary.target.minHitDecisionDatesPerYear}\``,
    `- minHitSymbolDatesPerYear: \`${summary.target.minHitSymbolDatesPerYear}\``,
    `- minPositiveSymbolDatesTotal: \`${summary.target.minPositiveSymbolDatesTotal}\``,
    "",
    "## Completion Evidence",
    "",
    `- frontierNormalizationStatus: \`${summary.evidence.frontierNormalization.status}\``,
    `- dominancePruneStatus: \`${summary.evidence.dominancePrune.status}\``,
    `- unsatBoundsStatus: \`${summary.evidence.unsatBounds.status}\``,
    `- partitionPlanStatus: \`${summary.evidence.partitionPlan.status}\``,
    `- partitionCompletionStatus: \`${summary.evidence.partitionCompletion.status}\``,
    `- survivorVerificationStatus: \`${summary.evidence.survivorVerification.status}\``,
    `- sourceRemainingFrontierSize: \`${summary.metrics.sourceRemainingFrontierSize}\``,
    `- remainingFrontierSize: \`${summary.metrics.remainingFrontierSize}\``,
    `- verifiedSurvivorCount: \`${summary.metrics.verifiedSurvivorCount}\``,
    `- acceptedCandidateCount: \`${summary.metrics.acceptedCandidateCount}\``,
    "",
    "## Interpretation",
    "",
    summary.conclusion.message,
    "",
  ]
  await fs.writeFile(outReportPath, `${lines.join("\n")}\n`, "utf8")
}

export const buildTp12Train100UnsatCompletionCertificate = async ({
  contractPath,
  outSummaryPath = "",
  outReportPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const outputSummaryPath = outputPathFromContract(cwd, contract, "certificateSummary", outSummaryPath)
  const outputReportPath = outputPathFromContract(cwd, contract, "certificateReport", outReportPath)

  const frontierNormalization = await safeSummary(cwd, contract?.outputPaths?.frontierNormalizationSummary, "frontierNormalizationSummary")
  const dominancePrune = await safeSummary(cwd, contract?.outputPaths?.dominancePruneSummary, "dominancePruneSummary")
  const unsatBounds = await safeSummary(cwd, contract?.outputPaths?.unsatBoundsSummary, "unsatBoundsSummary")
  const partitionPlan = await safeSummary(cwd, contract?.outputPaths?.partitionPlan, "partitionPlan")
  const partitionCompletion = await safeSummary(cwd, contract?.outputPaths?.partitionCompletionStatus, "partitionCompletionStatus")
  const survivorVerification = await safeSummary(cwd, contract?.outputPaths?.survivorVerificationSummary, "survivorVerificationSummary")
  const sourceExistenceCertificate = await safeSummary(
    cwd,
    contract?.searchScope?.sourceExistenceCertificate,
    "sourceExistenceCertificate",
    { optional: true },
  )
  const sourceCloseoutSummary = await safeSummary(cwd, contract?.searchScope?.sourceCloseoutSummary, "sourceCloseoutSummary", {
    optional: true,
  })

  const conclusion = buildConclusion({
    partitionStatus: partitionCompletion.payload,
    survivorSummary: survivorVerification.payload,
  })
  const metrics = {
    sourceRemainingFrontierSize: Math.max(
      0,
      Math.trunc(
        numeric(sourceCloseoutSummary.payload, ["remainingFrontierSize"], numeric(frontierNormalization.payload, ["unresolvedFrontierCount"], 0)),
      ),
    ),
    normalizedFrontierSize: Math.max(0, Math.trunc(numeric(frontierNormalization.payload, ["outputFrontierSize"], 0))),
    dominancePrunedFrontierSize: Math.max(0, Math.trunc(numeric(dominancePrune.payload, ["outputFrontierSize"], 0))),
    boundsPrunedFrontierSize: Math.max(0, Math.trunc(numeric(unsatBounds.payload, ["outputFrontierSize"], 0))),
    remainingFrontierSize: Math.max(0, Math.trunc(numeric(partitionCompletion.payload, ["remainingFrontierSize"], 0))),
    verifiedSurvivorCount: Math.max(0, Math.trunc(numeric(survivorVerification.payload, ["verifiedSurvivorCount"], 0))),
    acceptedCandidateCount: Math.max(0, Math.trunc(numeric(partitionCompletion.payload, ["acceptedCandidateCount"], 0))),
    globalVisitedStateCount: Math.max(0, Math.trunc(numeric(sourceCloseoutSummary.payload, ["globalVisitedStateCount"], 0))),
  }

  const summary = {
    kind: "tp12_train100_unsat_completion_certificate_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    trainDateRange: contract.trainDateRange,
    forbiddenDateRange: contract.forbiddenDateRange,
    target: contract.target,
    searchScope: contract.searchScope ?? {},
    completion: contract.completion ?? {},
    oosRead: false,
    lockedSelectorEmitted: false,
    selectorEmitted: false,
    conclusion,
    metrics,
    evidence: {
      frontierNormalization: {
        path: frontierNormalization.path,
        status: frontierNormalization.payload?.status ?? null,
        blockedReason: frontierNormalization.payload?.blockedReason ?? null,
      },
      dominancePrune: {
        path: dominancePrune.path,
        status: dominancePrune.payload?.status ?? null,
        proofMode: dominancePrune.payload?.proofMode ?? null,
      },
      unsatBounds: {
        path: unsatBounds.path,
        status: unsatBounds.payload?.status ?? null,
        proofMode: unsatBounds.payload?.proofMode ?? null,
      },
      partitionPlan: {
        path: partitionPlan.path,
        status: partitionPlan.payload?.status ?? null,
        shardCount: partitionPlan.payload?.shardCount ?? null,
      },
      partitionCompletion: {
        path: partitionCompletion.path,
        status: partitionCompletion.payload?.status ?? null,
        searchComplete: partitionCompletion.payload?.searchComplete === true,
        blockedReason: partitionCompletion.payload?.blockedReason ?? null,
      },
      survivorVerification: {
        path: survivorVerification.path,
        status: survivorVerification.payload?.status ?? null,
        blockedReason: survivorVerification.payload?.blockedReason ?? null,
      },
      sourceExistenceCertificate: {
        path: sourceExistenceCertificate.path,
        conclusion: sourceExistenceCertificate.payload?.conclusion?.code ?? null,
        existenceResolved: sourceExistenceCertificate.payload?.conclusion?.existenceResolved ?? null,
      },
      sourceCloseoutSummary: {
        path: sourceCloseoutSummary.path,
        closeoutStatus: sourceCloseoutSummary.payload?.closeoutStatus ?? null,
        remainingFrontierSize: sourceCloseoutSummary.payload?.remainingFrontierSize ?? null,
      },
    },
  }

  await writeSummary(outputSummaryPath, summary)
  await writeMarkdownReport({ outReportPath: outputReportPath, summary })
  return summary
}

