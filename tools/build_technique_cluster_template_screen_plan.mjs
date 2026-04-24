#!/usr/bin/env node

import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"
import { toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"
import { TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_PLAN_KIND } from "../src/lib/technique_cluster_template_screen_contract.mjs"

const compareBanks = (left, right) => {
  if (Number(right?.passScreen) !== Number(left?.passScreen)) {
    return Number(right?.passScreen) - Number(left?.passScreen)
  }
  const hitRateDelta = Number(right?.oosHitRate ?? 0) - Number(left?.oosHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  return String(left?.clusterBankId ?? left?.bankId ?? "").localeCompare(String(right?.clusterBankId ?? right?.bankId ?? ""))
}

const compareSelectedTemplateEntries = (left, right) => {
  const roleOrder = (role) => {
    if (role === "leader") return 0
    if (role === "breadth") return 1
    return 2
  }
  const roleDelta = roleOrder(toText(left?.clusterRole)) - roleOrder(toText(right?.clusterRole))
  if (roleDelta !== 0) return roleDelta
  const hitRateDelta = Number(right?.totalHitRate ?? 0) - Number(left?.totalHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  return String(left?.candidateTemplateId ?? "").localeCompare(String(right?.candidateTemplateId ?? ""))
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH))
  const clusterBankSummaryPath = toText(getFlag(flags, "cluster-bank-summary-path", ""))
  const clusterBankIds = uniqueSortedStrings(String(getFlag(flags, "cluster-bank-ids", "")).split(","))
  const templateIds = uniqueSortedStrings(String(getFlag(flags, "template-ids", "")).split(","))
  const maxTemplatesRaw = Number(getFlag(flags, "max-templates", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!clusterBankSummaryPath || !outPath) {
    throw new Error("build_technique_cluster_template_screen_plan requires --cluster-bank-summary-path and --out")
  }
  return {
    cwd,
    contractPath,
    clusterBankSummaryPath: path.resolve(cwd, clusterBankSummaryPath),
    clusterBankIds,
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
  const clusterBankSummary = await readJson(args.clusterBankSummaryPath, null)
  if (!clusterBankSummary || typeof clusterBankSummary !== "object") {
    throw new Error(`Missing cluster bank discovery summary: ${args.clusterBankSummaryPath}`)
  }
  const requestedBankIds = new Set(args.clusterBankIds)
  const requestedTemplateIds = new Set(args.templateIds)
  const banks = (Array.isArray(clusterBankSummary.banks) ? clusterBankSummary.banks : [])
    .filter((bank) => bank?.passScreen === true)
    .filter((bank) => toText(bank?.entryType) !== "reserve_bank")
    .filter((bank) => (Array.isArray(bank?.selectedTemplateEntries) ? bank.selectedTemplateEntries.length : 0) > 0)
    .filter((bank) => requestedBankIds.size < 1 || requestedBankIds.has(toText(bank?.clusterBankId)))
    .slice()
    .sort(compareBanks)
  if (banks.length < 1) {
    throw new Error("No passed cluster banks remain for cluster template screen planning")
  }

  const selectedTemplates = []
  for (const bank of banks) {
    const templateEntries = (Array.isArray(bank?.selectedTemplateEntries) ? bank.selectedTemplateEntries : [])
      .filter((entry) => requestedTemplateIds.size < 1 || requestedTemplateIds.has(toText(entry?.candidateTemplateId)))
      .slice()
      .sort(compareSelectedTemplateEntries)
    for (const templateEntry of templateEntries) {
      if (args.maxTemplates !== null && selectedTemplates.length >= Number(args.maxTemplates)) break
      selectedTemplates.push({
        planRank: selectedTemplates.length + 1,
        bankId: toText(bank?.sourceBankId) || toText(bank?.bankId),
        sourceBankId: toText(bank?.sourceBankId) || toText(bank?.bankId),
        sourceClusterBankId: toText(bank?.clusterBankId) || null,
        clusterId: toText(bank?.clusterId) || null,
        clusterRole: toText(templateEntry?.clusterRole) || null,
        selectionReason: toText(templateEntry?.selectionReason) || "cluster_bank_pass_screen",
        entryType: toText(bank?.entryType) || "cluster_lane",
        candidateTemplateId: toText(templateEntry?.candidateTemplateId),
        seedId: toText(templateEntry?.seedId),
        mechanismId: toText(bank?.mechanismId),
        scopeId: toText(bank?.scopeId),
        lookbackCandidateId: toText(bank?.lookbackCandidateId),
        observedBankIds: Array.isArray(templateEntry?.observedBankIds) ? templateEntry.observedBankIds.slice() : [],
        observedScopeIds: Array.isArray(templateEntry?.observedScopeIds)
          ? templateEntry.observedScopeIds.slice()
          : [],
        observedLookbackCandidateIds: Array.isArray(templateEntry?.observedLookbackCandidateIds)
          ? templateEntry.observedLookbackCandidateIds.slice()
          : [],
        observedDecisionDayCount: Number(templateEntry?.observedDecisionDayCount ?? 0) || 0,
        observedEventCount: Number(templateEntry?.observedEventCount ?? 0) || 0,
        observedHitCount: Number(templateEntry?.observedHitCount ?? 0) || 0,
        observedHitRate: Number(templateEntry?.observedHitRate ?? 0) || 0,
        totalEventCount: Number(templateEntry?.totalEventCount ?? 0) || 0,
        totalHitCount: Number(templateEntry?.totalHitCount ?? 0) || 0,
        totalHitRate: Number(templateEntry?.totalHitRate ?? 0) || 0,
        coveredYears: Number(templateEntry?.coveredYears ?? 0) || 0,
        yearsWithHitGe2: Number(templateEntry?.yearsWithHitGe2 ?? 0) || 0,
        yearsWithHitGe1: Number(templateEntry?.yearsWithHitGe1 ?? 0) || 0,
        yearsWithEventCountGeMin: Number(templateEntry?.yearsWithEventCountGeMin ?? 0) || 0,
        signalsPer20TradingDays: Number(templateEntry?.signalsPer20TradingDays ?? 0) || 0,
        maxYearShare: Number(templateEntry?.maxYearShare ?? 0) || 0,
        allClauseIds: Array.isArray(templateEntry?.allClauseIds) ? templateEntry.allClauseIds.slice() : [],
        anchorClauseIds: Array.isArray(templateEntry?.anchorClauseIds) ? templateEntry.anchorClauseIds.slice() : [],
        retestClauseIds: Array.isArray(templateEntry?.retestClauseIds) ? templateEntry.retestClauseIds.slice() : [],
        compressionClauseIds: Array.isArray(templateEntry?.compressionClauseIds)
          ? templateEntry.compressionClauseIds.slice()
          : [],
        confirmClauseIds: Array.isArray(templateEntry?.confirmClauseIds) ? templateEntry.confirmClauseIds.slice() : [],
        invalidateClauseIds: Array.isArray(templateEntry?.invalidateClauseIds)
          ? templateEntry.invalidateClauseIds.slice()
          : [],
        templateScreenConfig: { ...techniqueContract.templateScreen },
      })
    }
  }
  if (selectedTemplates.length < 1) {
    throw new Error("Cluster template screen plan resolved zero templates")
  }

  const payload = {
    kind: TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_PLAN_KIND,
    contractId: toText(techniqueContract.contractId),
    clusterBankSummaryPath: args.clusterBankSummaryPath,
    clusterBankRunId: toText(clusterBankSummary?.runId),
    selectedClusterBankCount: uniqueSortedStrings(selectedTemplates.map((entry) => entry.sourceClusterBankId)).length,
    selectedTemplateCount: selectedTemplates.length,
    selectedTemplates,
    templateScreenConfig: { ...techniqueContract.templateScreen },
    notes: [
      "This artifact is the cluster-bank-driven T4 entry plan.",
      "Only passed cluster-bank entries with explicit selected template representatives should advance to T4 rolling.",
      "Reserve banks without template representatives are intentionally excluded from T4 template-only rolling.",
    ],
  }
  await writeJson(args.outPath, payload)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        selectedClusterBankCount: payload.selectedClusterBankCount,
        selectedTemplateCount: payload.selectedTemplateCount,
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
