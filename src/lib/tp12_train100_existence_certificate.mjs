import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { toBool, toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"

const PATCH_KEY = "tp12_train100_year2hit_existence_cert_v1"

const validDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(toText(value))

const looksLikeOosPath = (filePath) => {
  const normalized = toText(filePath).replace(/\\/g, "/").toLowerCase()
  if (!normalized) return false
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some((part) => part === "oos" || part.startsWith("oos_") || part.startsWith("oos-"))) return true
  const base = parts.at(-1) ?? ""
  if (base.startsWith("oos_") || base.startsWith("oos-") || base === "oos.json") return true
  return /(^|[^0-9])2025-\d{2}-\d{2}([^0-9]|$)/.test(normalized) || /(^|[^0-9])2026-\d{2}-\d{2}([^0-9]|$)/.test(normalized)
}

const assertNoOosSourcePath = (filePath, label) => {
  if (looksLikeOosPath(filePath)) {
    throw new Error(`${label} appears to reference OOS data and is forbidden: ${filePath}`)
  }
}

const resolveExisting = (cwd, filePath, label) => {
  const text = toText(filePath)
  if (!text) throw new Error(`${label} is required`)
  assertNoOosSourcePath(text, label)
  const resolved = path.resolve(cwd, text)
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

const assertTarget = (contract) => {
  const target = contract?.target ?? {}
  const failures = []
  if (Math.trunc(toNumber(target.minHitDecisionDatesPerYear, 0)) !== 2) failures.push("minHitDecisionDatesPerYear_must_equal_2")
  if (Math.trunc(toNumber(target.minHitSymbolDatesPerYear, 0)) !== 2) failures.push("minHitSymbolDatesPerYear_must_equal_2")
  if (Math.trunc(toNumber(target.minPositiveSymbolDatesTotal, 0)) < 18) failures.push("minPositiveSymbolDatesTotal_must_be_at_least_18")
  if (toNumber(target.requiredTrainPrecision, 0) !== 1) failures.push("requiredTrainPrecision_must_equal_1")
  if (Math.trunc(toNumber(target.maxFalsePositiveRows, 999)) !== 0) failures.push("maxFalsePositiveRows_must_equal_0")
  if (failures.length > 0) throw new Error(`invalid train100 existence target: ${failures.join("; ")}`)
}

const assertContract = (contract) => {
  if (contract?.kind !== "tp12_train100_year2hit_existence_cert_contract_v1") {
    throw new Error(`invalid existence certificate contract kind: ${contract?.kind ?? "missing"}`)
  }
  if (contract?.patchKey !== PATCH_KEY) {
    throw new Error(`invalid patchKey: expected ${PATCH_KEY}, got ${contract?.patchKey ?? "missing"}`)
  }
  const trainFrom = toText(contract?.trainDateRange?.from)
  const trainTo = toText(contract?.trainDateRange?.to)
  if (!validDateKey(trainFrom) || !validDateKey(trainTo) || trainFrom > trainTo) {
    throw new Error(`invalid trainDateRange: ${trainFrom || "missing"}..${trainTo || "missing"}`)
  }
  const forbiddenFrom = toText(contract?.forbiddenDateRange?.from)
  const forbiddenTo = toText(contract?.forbiddenDateRange?.to)
  if (!validDateKey(forbiddenFrom) || !validDateKey(forbiddenTo) || forbiddenFrom > forbiddenTo) {
    throw new Error(`invalid forbiddenDateRange: ${forbiddenFrom || "missing"}..${forbiddenTo || "missing"}`)
  }
  assertTarget(contract)
  const rules = contract?.globalRules ?? {}
  const forbiddenTrueFlags = [
    "oosReadAllowed",
    "emitLockedSelector",
    "oosReplayAllowed",
    "fallbackAllowed",
    "relaxYear2HitAllowed",
    "relaxTrainPrecisionAllowed",
  ]
  const badFlags = forbiddenTrueFlags.filter((key) => toBool(rules[key], false) === true)
  if (badFlags.length > 0) throw new Error(`train100 existence contract has forbidden true flags: ${badFlags.join(",")}`)
  if (!Array.isArray(contract?.scopes) || contract.scopes.length < 1) {
    throw new Error("train100 existence contract requires at least one scope")
  }
}

const assertManifestNotOos = (manifest, label) => {
  if (manifest?.oosRead === true) throw new Error(`${label} has oosRead=true`)
  for (const key of ["oosReplayAllowed", "lockedSelectorEmitted"]) {
    if (manifest?.[key] === true) throw new Error(`${label} has forbidden ${key}=true`)
  }
}

const statusForCompleteExact = ({ scope, atomManifest, exactManifest, qualitySummary }) => {
  assertManifestNotOos(atomManifest, `${scope.scopeId}:atomManifest`)
  assertManifestNotOos(exactManifest, `${scope.scopeId}:exactManifest`)
  assertManifestNotOos(qualitySummary, `${scope.scopeId}:qualitySummary`)
  const accepted = Math.max(0, Math.trunc(toNumber(exactManifest?.acceptedCandidateCount, 0)))
  const qualityAccepted = Math.max(0, Math.trunc(toNumber(qualitySummary?.acceptedCount, 0)))
  const searchComplete = exactManifest?.searchComplete === true
  if (accepted > 0 || qualityAccepted > 0) return "survivor_found"
  if (searchComplete) return "absence_proven_in_scope"
  return "no_survivor_observed_incomplete"
}

const buildCompleteExactScope = async ({ cwd, scope }) => {
  const atomManifestPath = resolveExisting(cwd, scope.atomManifestPath, `${scope.scopeId}.atomManifestPath`)
  const exactManifestPath = resolveExisting(cwd, scope.exactManifestPath, `${scope.scopeId}.exactManifestPath`)
  const qualitySummaryPath = resolveExisting(cwd, scope.qualitySummaryPath, `${scope.scopeId}.qualitySummaryPath`)
  const [atomManifest, exactManifest, qualitySummary] = await Promise.all([
    readJson(atomManifestPath),
    readJson(exactManifestPath),
    readJson(qualitySummaryPath),
  ])
  const absenceStatus = statusForCompleteExact({ scope, atomManifest, exactManifest, qualitySummary })
  return {
    scopeId: scope.scopeId,
    proofKind: scope.proofKind,
    description: toText(scope.description),
    absenceStatus,
    searchComplete: exactManifest?.searchComplete === true,
    status: exactManifest?.status ?? null,
    atomCount: atomManifest?.atomCount ?? exactManifest?.atomCount ?? null,
    seedAtomCount: exactManifest?.seedAtomCount ?? null,
    evaluatedCandidateCount: exactManifest?.evaluatedCandidateCount ?? null,
    acceptedCandidateCount: exactManifest?.acceptedCandidateCount ?? null,
    qualityAcceptedCount: qualitySummary?.acceptedCount ?? null,
    rejectedReasonCounts: exactManifest?.rejectedReasonCounts ?? {},
    sourcePaths: {
      atomManifestPath,
      exactManifestPath,
      qualitySummaryPath,
    },
  }
}

const buildIncompleteCloseoutScope = async ({ cwd, scope }) => {
  const closeoutSummaryPath = resolveExisting(cwd, scope.closeoutSummaryPath, `${scope.scopeId}.closeoutSummaryPath`)
  const closeout = await readJson(closeoutSummaryPath)
  assertManifestNotOos(closeout, `${scope.scopeId}:closeoutSummary`)
  const accepted = Math.max(
    Math.trunc(toNumber(closeout?.acceptedTrain100PatternCount, 0)),
    Math.trunc(toNumber(closeout?.acceptedCandidateCount, 0)),
  )
  let absenceStatus = "no_survivor_observed_incomplete"
  if (accepted > 0) absenceStatus = "survivor_found"
  else if (closeout?.searchComplete === true && Math.trunc(toNumber(closeout?.remainingFrontierSize, 0)) === 0) {
    absenceStatus = "absence_proven_in_scope"
  }
  return {
    scopeId: scope.scopeId,
    proofKind: scope.proofKind,
    description: toText(scope.description),
    absenceStatus,
    closeoutStatus: closeout?.closeoutStatus ?? null,
    decision: closeout?.decision ?? null,
    searchComplete: closeout?.searchComplete === true,
    acceptedTrain100PatternCount: closeout?.acceptedTrain100PatternCount ?? null,
    acceptedCandidateCount: closeout?.acceptedCandidateCount ?? null,
    globalVisitedStateCount: closeout?.globalVisitedStateCount ?? null,
    remainingFrontierSize: closeout?.remainingFrontierSize ?? null,
    allowedFutureUse: Array.isArray(closeout?.allowedFutureUse) ? closeout.allowedFutureUse : [],
    forbiddenFutureUse: Array.isArray(closeout?.forbiddenFutureUse) ? closeout.forbiddenFutureUse : [],
    sourcePaths: {
      closeoutSummaryPath,
    },
  }
}

const buildScopeCertificate = async ({ cwd, scope }) => {
  if (scope?.proofKind === "complete_exact_manifest") return buildCompleteExactScope({ cwd, scope })
  if (scope?.proofKind === "incomplete_counterexample_closeout") return buildIncompleteCloseoutScope({ cwd, scope })
  throw new Error(`unsupported train100 existence proofKind for ${scope?.scopeId ?? "unknown"}: ${scope?.proofKind ?? "missing"}`)
}

const globalConclusion = (scopes) => {
  if (scopes.some((scope) => scope.absenceStatus === "survivor_found")) {
    return {
      code: "train100_survivor_found_in_declared_scope",
      existenceResolved: true,
      message: "At least one declared scope found a train100 year2hit pattern.",
    }
  }
  if (scopes.every((scope) => scope.absenceStatus === "absence_proven_in_scope")) {
    return {
      code: "train100_absent_in_all_declared_scopes",
      existenceResolved: true,
      message: "Every declared scope is complete and found zero train100 year2hit patterns.",
    }
  }
  return {
    code: "no_survivor_found_but_global_existence_unresolved",
    existenceResolved: false,
    message: "No declared scope found a train100 year2hit pattern, but at least one scope is incomplete, so global existence is unresolved.",
  }
}

const writeMarkdown = async ({ outReportPath, summary }) => {
  if (!toText(outReportPath)) return
  const lines = [
    "# TP12 Train100 Year2Hit Existence Certificate",
    "",
    `- patchKey: \`${summary.patchKey}\``,
    `- status: \`${summary.status}\``,
    `- conclusion: \`${summary.conclusion.code}\``,
    `- existenceResolved: \`${summary.conclusion.existenceResolved}\``,
    `- oosRead: \`${summary.oosRead}\``,
    `- lockedSelectorEmitted: \`${summary.lockedSelectorEmitted}\``,
    "",
    "## Target",
    "",
    `- trainDateRange: \`${summary.trainDateRange.from}..${summary.trainDateRange.to}\``,
    `- requiredTrainPrecision: \`${summary.target.requiredTrainPrecision}\``,
    `- maxFalsePositiveRows: \`${summary.target.maxFalsePositiveRows}\``,
    `- minHitDecisionDatesPerYear: \`${summary.target.minHitDecisionDatesPerYear}\``,
    `- minPositiveSymbolDatesTotal: \`${summary.target.minPositiveSymbolDatesTotal}\``,
    "",
    "## Scopes",
    "",
    ...summary.scopes.flatMap((scope) => [
      `### ${scope.scopeId}`,
      "",
      `- proofKind: \`${scope.proofKind}\``,
      `- absenceStatus: \`${scope.absenceStatus}\``,
      `- searchComplete: \`${scope.searchComplete}\``,
      `- acceptedCandidateCount: \`${scope.acceptedCandidateCount ?? scope.acceptedTrain100PatternCount ?? "n/a"}\``,
      `- atomCount: \`${scope.atomCount ?? "n/a"}\``,
      `- visited/evaluated: \`${scope.globalVisitedStateCount ?? scope.evaluatedCandidateCount ?? "n/a"}\``,
      `- remainingFrontierSize: \`${scope.remainingFrontierSize ?? "n/a"}\``,
      "",
      scope.description ? `${scope.description}\n` : "",
    ]),
    "## Interpretation",
    "",
    summary.conclusion.message,
    "",
  ]
  await ensureDir(path.dirname(outReportPath))
  await fs.promises.writeFile(outReportPath, `${lines.join("\n")}\n`, "utf8")
}

export const buildTp12Train100ExistenceCertificate = async ({
  contractPath,
  outSummaryPath = "",
  outReportPath = "",
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = resolveExisting(cwd, contractPath, "contractPath")
  const contract = await readJson(resolvedContractPath)
  assertContract(contract)
  const scopes = []
  for (const scope of contract.scopes) {
    scopes.push(await buildScopeCertificate({ cwd, scope }))
  }
  const conclusion = globalConclusion(scopes)
  const outputSummaryPath = toText(outSummaryPath)
    ? path.resolve(cwd, outSummaryPath)
    : path.resolve(cwd, contract.outputPaths?.summary ?? "")
  if (!toText(outputSummaryPath)) throw new Error("outSummaryPath is required")
  const outputReportPath = toText(outReportPath)
    ? path.resolve(cwd, outReportPath)
    : toText(contract.outputPaths?.report)
      ? path.resolve(cwd, contract.outputPaths.report)
      : ""
  const summary = {
    kind: "tp12_train100_year2hit_existence_certificate_v1",
    generatedAt: new Date().toISOString(),
    patchKey: PATCH_KEY,
    status: "passed",
    contractPath: resolvedContractPath,
    trainDateRange: contract.trainDateRange,
    forbiddenDateRange: contract.forbiddenDateRange,
    target: contract.target,
    label: contract.label,
    oosRead: false,
    lockedSelectorEmitted: false,
    scopes,
    conclusion,
    hardStops: contract.hardStops ?? [],
  }
  await writeJson(outputSummaryPath, summary)
  await writeMarkdown({ outReportPath: outputReportPath, summary })
  return summary
}

