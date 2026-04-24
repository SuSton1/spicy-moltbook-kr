#!/usr/bin/env node

import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { TECHNIQUE_BANK_SHORTLIST_KIND } from "../src/lib/technique_bank_builder.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"
import { parseTechniqueBankId, toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"
import { TECHNIQUE_TEMPLATE_SCREEN_PLAN_KIND } from "../src/lib/technique_template_screen_contract.mjs"

const compareTemplates = (left, right) => {
  const leftRank = Number(left?.shortlistRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.shortlistRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  const hitRateDelta = Number(right?.observedHitRate ?? 0) - Number(left?.observedHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  return String(left?.candidateTemplateId ?? "").localeCompare(String(right?.candidateTemplateId ?? ""))
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH))
  const shortlistPath = toText(getFlag(flags, "shortlist-path", ""))
  const bankId = toText(getFlag(flags, "bank-id", ""))
  const templateIds = uniqueSortedStrings(String(getFlag(flags, "template-ids", "")).split(","))
  const maxTemplatesRaw = Number(getFlag(flags, "max-templates", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!shortlistPath || !outPath) {
    throw new Error(
      "build_technique_template_screen_plan requires --shortlist-path and --out",
    )
  }
  return {
    cwd,
    contractPath,
    shortlistPath: path.resolve(cwd, shortlistPath),
    bankId,
    templateIds,
    maxTemplates: Number.isInteger(maxTemplatesRaw) && maxTemplatesRaw > 0 ? maxTemplatesRaw : null,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const techniqueContract = await loadTechniqueGrammarContract({
    contractPath: args.contractPath,
    cwd,
  })
  const shortlistArtifact = await readJson(args.shortlistPath, null)
  if (!shortlistArtifact || typeof shortlistArtifact !== "object") {
    throw new Error(`Missing shortlist artifact: ${args.shortlistPath}`)
  }
  if (toText(shortlistArtifact.kind) !== TECHNIQUE_BANK_SHORTLIST_KIND) {
    throw new Error(
      `Expected shortlist kind ${TECHNIQUE_BANK_SHORTLIST_KIND}, got ${toText(shortlistArtifact.kind) || "<empty>"}`,
    )
  }

  const shortlistedBanks = Array.isArray(shortlistArtifact.shortlistedBanks)
    ? shortlistArtifact.shortlistedBanks
    : []
  const shortlistedTemplates = Array.isArray(shortlistArtifact.shortlistedTemplates)
    ? shortlistArtifact.shortlistedTemplates
    : []
  if (shortlistedBanks.length < 1) {
    throw new Error("shortlistArtifact.shortlistedBanks is empty")
  }
  if (shortlistedTemplates.length < 1) {
    throw new Error("shortlistArtifact.shortlistedTemplates is empty")
  }

  const selectedBankId = args.bankId || toText(shortlistedBanks[0]?.bankId)
  if (!selectedBankId) {
    throw new Error("Unable to resolve selected bank id")
  }
  const shortlistedBank = shortlistedBanks.find((entry) => toText(entry.bankId) === selectedBankId)
  if (!shortlistedBank) {
    throw new Error(`Selected bank is not present in shortlist artifact: ${selectedBankId}`)
  }
  const concrete = parseTechniqueBankId(selectedBankId)

  const requestedTemplateIds = new Set(args.templateIds)
  const bankTemplates = shortlistedTemplates
    .filter((template) => (Array.isArray(template?.observedBankIds) ? template.observedBankIds : []).includes(selectedBankId))
    .slice()
    .sort(compareTemplates)
  if (bankTemplates.length < 1) {
    throw new Error(`Selected bank ${selectedBankId} has zero shortlisted templates`)
  }
  for (const templateId of requestedTemplateIds) {
    if (!bankTemplates.some((template) => toText(template.candidateTemplateId) === templateId)) {
      throw new Error(`Requested template is not attached to selected bank: ${templateId}`)
    }
  }
  const chosenTemplates = bankTemplates
    .filter((template) => requestedTemplateIds.size < 1 || requestedTemplateIds.has(toText(template.candidateTemplateId)))
    .slice(0, args.maxTemplates ?? bankTemplates.length)
  if (chosenTemplates.length < 1) {
    throw new Error("No templates remain after applying template selection filters")
  }

  const selectedTemplates = chosenTemplates.map((template, index) => {
    const observedScopeIds = uniqueSortedStrings(template?.observedScopeIds)
    const observedLookbackCandidateIds = uniqueSortedStrings(template?.observedLookbackCandidateIds)
    if (observedScopeIds.length > 0 && !observedScopeIds.includes(concrete.scopeId)) {
      throw new Error(
        `Observed scope ids for ${template.candidateTemplateId} do not include bank scope ${concrete.scopeId}`,
      )
    }
    if (
      observedLookbackCandidateIds.length > 0 &&
      !observedLookbackCandidateIds.includes(concrete.lookbackCandidateId)
    ) {
      throw new Error(
        `Observed lookback ids for ${template.candidateTemplateId} do not include bank lookback ${concrete.lookbackCandidateId}`,
      )
    }
    return {
      planRank: index + 1,
      bankId: selectedBankId,
      candidateTemplateId: toText(template.candidateTemplateId),
      seedId: toText(template.seedId),
      mechanismId: concrete.mechanismId,
      scopeId: concrete.scopeId,
      lookbackCandidateId: concrete.lookbackCandidateId,
      observedBankIds: uniqueSortedStrings(template?.observedBankIds),
      observedScopeIds,
      observedLookbackCandidateIds,
      observedDecisionDayCount: Number(template?.observedDecisionDayCount ?? 0) || 0,
      observedEventCount: Number(template?.observedEventCount ?? 0) || 0,
      observedHitCount: Number(template?.observedHitCount ?? 0) || 0,
      observedHitRate: Number(template?.observedHitRate ?? 0) || 0,
      totalEventCount: Number(template?.totalEventCount ?? 0) || 0,
      totalHitCount: Number(template?.totalHitCount ?? 0) || 0,
      totalHitRate: Number(template?.totalHitRate ?? 0) || 0,
      coveredYears: Number(template?.coveredYears ?? 0) || 0,
      yearsWithHitGe2: Number(template?.yearsWithHitGe2 ?? 0) || 0,
      yearsWithHitGe1: Number(template?.yearsWithHitGe1 ?? 0) || 0,
      yearsWithEventCountGeMin: Number(template?.yearsWithEventCountGeMin ?? 0) || 0,
      signalsPer20TradingDays: Number(template?.signalsPer20TradingDays ?? 0) || 0,
      maxYearShare: Number(template?.maxYearShare ?? 0) || 0,
      allClauseIds: uniqueSortedStrings(template?.allClauseIds),
      anchorClauseIds: uniqueSortedStrings(template?.anchorClauseIds),
      retestClauseIds: uniqueSortedStrings(template?.retestClauseIds),
      compressionClauseIds: uniqueSortedStrings(template?.compressionClauseIds),
      confirmClauseIds: uniqueSortedStrings(template?.confirmClauseIds),
      invalidateClauseIds: uniqueSortedStrings(template?.invalidateClauseIds),
      templateScreenConfig: { ...techniqueContract.templateScreen },
    }
  })

  const payload = {
    kind: TECHNIQUE_TEMPLATE_SCREEN_PLAN_KIND,
    contractId: toText(techniqueContract.contractId),
    shortlistKind: toText(shortlistArtifact.kind),
    shortlistContractId: toText(shortlistArtifact.contractId),
    shortlistPath: args.shortlistPath,
    sourceBankId: selectedBankId,
    sourceBankBestTemplateId: toText(shortlistedBank.bestTemplateId),
    sourceBankShortlistedTemplateCount: Number(shortlistedBank.shortlistedTemplateCount ?? 0) || 0,
    selectedTemplateCount: selectedTemplates.length,
    selectedTemplates,
    templateScreenConfig: { ...techniqueContract.templateScreen },
    notes: [
      "This artifact is the shortlist-driven T4 entry plan.",
      "Only templates attached to the selected passed bank should advance to T4 template-only rolling.",
      "Do not reuse bank aggregate counts as if they were already single-template results.",
    ],
  }
  await writeJson(args.outPath, payload)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        sourceBankId: selectedBankId,
        selectedTemplateCount: payload.selectedTemplateCount,
        topTemplateId: payload.selectedTemplates?.[0]?.candidateTemplateId ?? null,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
