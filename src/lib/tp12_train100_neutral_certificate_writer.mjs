import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  loadTp12Train100NeutralContract,
  outputPathFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"

const readRequired = async (filePath, label) => {
  const payload = await readJson(filePath, null)
  if (!payload) throw new Error(`${label} is not readable JSON: ${filePath}`)
  if (payload.oosRead === true) throw new Error(`${label} has oosRead=true`)
  if (payload.fallbackUsed === true) throw new Error(`${label} has fallbackUsed=true`)
  return payload
}

const conclusionFor = ({ anchorSummary, searchSummary, verifierSummary }) => {
  const verified = Number(verifierSummary?.verifiedPatternCount ?? 0)
  if (verified > 0) {
    return {
      code: "train100_neutral_survivor_found",
      kind: "tp12_train100_neutral_found_certificate_v1",
      existenceResolved: true,
      absenceProvenInScope: false,
      message: "At least one neutral anchor/veto expression passed exact train100 verification.",
    }
  }
  if (anchorSummary?.searchComplete === true && searchSummary?.searchComplete === true && Number(searchSummary?.incompleteAnchorCount ?? 0) === 0) {
    return {
      code: "complete_no_survivor_in_neutral_expression_space",
      kind: "tp12_train100_neutral_unsat_certificate_v1",
      existenceResolved: true,
      absenceProvenInScope: true,
      message: "The declared neutral expression search completed and exact verification found zero survivors.",
    }
  }
  return {
    code: "incomplete_no_survivor_found",
    kind: "tp12_train100_neutral_incomplete_certificate_v1",
    existenceResolved: false,
    absenceProvenInScope: false,
    message: "No neutral train100 survivor was verified, but at least one search stage is incomplete, so absence is not proven.",
  }
}

const writeMarkdown = async (outReportPath, summary) => {
  if (!outReportPath) return
  await ensureDir(path.dirname(outReportPath))
  const lines = [
    "# TP12 Train100 Neutral Anchor/Veto Certificate",
    "",
    `- patchKey: \`${summary.patchKey}\``,
    `- status: \`${summary.status}\``,
    `- conclusion: \`${summary.conclusion.code}\``,
    `- existenceResolved: \`${summary.conclusion.existenceResolved}\``,
    `- absenceProvenInScope: \`${summary.conclusion.absenceProvenInScope}\``,
    `- oosRead: \`${summary.oosRead}\``,
    `- fallbackUsed: \`${summary.fallbackUsed}\``,
    "",
    "## Metrics",
    "",
    `- featureAtomSpecCount: \`${summary.metrics.featureAtomSpecCount}\``,
    `- emittedAtomCount: \`${summary.metrics.emittedAtomCount}\``,
    `- generatedAnchorCount: \`${summary.metrics.generatedAnchorCount}\``,
    `- foundPatternCount: \`${summary.metrics.foundPatternCount}\``,
    `- verifiedPatternCount: \`${summary.metrics.verifiedPatternCount}\``,
    `- incompleteAnchorCount: \`${summary.metrics.incompleteAnchorCount}\``,
    "",
    "## Interpretation",
    "",
    summary.conclusion.message,
    "",
  ]
  await fs.writeFile(outReportPath, `${lines.join("\n")}\n`, "utf8")
}

export const writeTp12Train100NeutralExpressionSpaceCertificate = async ({
  contractPath,
  featureManifestPath = "",
  atomManifestPath = "",
  anchorSummaryPath = "",
  searchSummaryPath = "",
  verifierSummaryPath = "",
  outSummaryPath = "",
  outReportPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const featureManifest = await readRequired(path.resolve(cwd, featureManifestPath || contract.outputPaths.featureSpaceManifest), "featureManifest")
  const atomManifest = await readRequired(path.resolve(cwd, atomManifestPath || contract.outputPaths.neutralAtomBitsetManifest), "atomManifest")
  const anchorSummary = await readRequired(path.resolve(cwd, anchorSummaryPath || contract.outputPaths.anchorGenerationSummary), "anchorSummary")
  const searchSummary = await readRequired(path.resolve(cwd, searchSummaryPath || contract.outputPaths.anchorVetoSearchSummary), "searchSummary")
  const verifierSummary = await readRequired(path.resolve(cwd, verifierSummaryPath || contract.outputPaths.survivorVerifierSummary), "verifierSummary")
  const outputSummaryPath = outputPathFromContract(cwd, contract, "certificateSummary", outSummaryPath)
  const outputReportPath = outputPathFromContract(cwd, contract, "certificateReport", outReportPath)
  const conclusion = conclusionFor({ anchorSummary, searchSummary, verifierSummary })
  const summary = {
    kind: "tp12_train100_neutral_expression_space_certificate_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    trainDateRange: contract.trainDateRange,
    forbiddenDateRange: contract.forbiddenDateRange,
    objective: contract.objective,
    expression: contract.expression,
    oosRead: false,
    fallbackUsed: false,
    lockedSelectorEmitted: false,
    conclusion,
    metrics: {
      featureAtomSpecCount: featureManifest.atomSpecCount ?? 0,
      emittedAtomCount: atomManifest.emittedAtomCount ?? 0,
      generatedAnchorCount: anchorSummary.generatedAnchorCount ?? 0,
      foundPatternCount: searchSummary.foundPatternCount ?? 0,
      verifiedPatternCount: verifierSummary.verifiedPatternCount ?? 0,
      incompleteAnchorCount: searchSummary.incompleteAnchorCount ?? 0,
      anchorSearchComplete: anchorSummary.searchComplete === true,
      vetoSearchComplete: searchSummary.searchComplete === true,
    },
    evidence: {
      featureManifestPath: path.resolve(cwd, featureManifestPath || contract.outputPaths.featureSpaceManifest),
      atomManifestPath: path.resolve(cwd, atomManifestPath || contract.outputPaths.neutralAtomBitsetManifest),
      anchorSummaryPath: path.resolve(cwd, anchorSummaryPath || contract.outputPaths.anchorGenerationSummary),
      searchSummaryPath: path.resolve(cwd, searchSummaryPath || contract.outputPaths.anchorVetoSearchSummary),
      verifierSummaryPath: path.resolve(cwd, verifierSummaryPath || contract.outputPaths.survivorVerifierSummary),
    },
  }
  await writeJson(outputSummaryPath, summary)
  await writeMarkdown(outputReportPath, summary)
  return summary
}

export const writeTp12Train100NeutralFoundCertificate = writeTp12Train100NeutralExpressionSpaceCertificate
export const writeTp12Train100NeutralUnsatCertificate = writeTp12Train100NeutralExpressionSpaceCertificate
export const writeTp12Train100NeutralIncompleteCertificate = writeTp12Train100NeutralExpressionSpaceCertificate

