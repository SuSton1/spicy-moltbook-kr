#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueTemplateScreenRunSlug } from "../src/lib/technique_template_screen_contract.mjs"
import {
  buildTechniqueOperatingBridgeManifest,
  buildTechniqueYearConsensusTemplateSummary,
  selectTechniqueYearConsensusTemplates,
  TECHNIQUE_YEAR_CONSENSUS_SUMMARY_KIND,
} from "../src/lib/technique_year_consensus.mjs"
import { toText, uniqueSortedStrings, yearKeyFromDateKey } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", "meta/technique_grammar_contract.json"))
  const templateScreenSummaryPath = toText(getFlag(flags, "template-screen-summary-path", ""))
  const outDir = toText(getFlag(flags, "out-dir", ""))
  const templateIds = uniqueSortedStrings(String(getFlag(flags, "template-ids", "")).split(","))
  if (!templateScreenSummaryPath || !outDir) {
    throw new Error(
      "build_technique_year_consensus_summary requires --template-screen-summary-path and --out-dir",
    )
  }
  return {
    cwd,
    contractPath,
    templateScreenSummaryPath: path.resolve(cwd, templateScreenSummaryPath),
    outDir: path.resolve(cwd, outDir),
    templateIds,
  }
}

const resolveScopeRunDir = ({ window, cwd }) => {
  const freezeResultPath = toText(window?.search?.freezeResultPath)
  if (freezeResultPath) {
    return path.dirname(path.resolve(freezeResultPath))
  }
  const scopeRunId = toText(window?.scopeRunId)
  if (!scopeRunId) {
    throw new Error(`window ${toText(window?.windowId) || "<unknown>"} is missing scopeRunId/freezeResultPath`)
  }
  return path.resolve(cwd, "artifacts", "runs", scopeRunId)
}

const loadScreenWindowArtifacts = async ({ template, rollingSummary, cwd }) => {
  const windows = Array.isArray(rollingSummary?.windows) ? rollingSummary.windows : []
  const screenWindows = windows.filter((window) => {
    const kindWindow = toText(window?.kindWindow)
    if (kindWindow) return kindWindow === "screen"
    return toText(window?.kind) === "screen"
  })
  if (screenWindows.length < 1) {
    throw new Error(`template ${template.candidateTemplateId} rolling summary has no screen windows`)
  }
  const loaded = []
  for (const window of screenWindows) {
    const scopeRunDir = resolveScopeRunDir({ window, cwd })
    const selectionLeaderboardPath = path.join(
      scopeRunDir,
      "step-perfect-prototype-open-eval-report",
      "selection_leaderboard.json",
    )
    const freezeResultPath = path.join(scopeRunDir, "freeze_result.json")
    const [selectionLeaderboardRows, freezeResult] = await Promise.all([
      readJson(selectionLeaderboardPath, null),
      readJson(freezeResultPath, null),
    ])
    if (!Array.isArray(selectionLeaderboardRows) || selectionLeaderboardRows.length < 1) {
      throw new Error(
        `template ${template.candidateTemplateId} is missing selection_leaderboard rows: ${selectionLeaderboardPath}`,
      )
    }
    if (!freezeResult || typeof freezeResult !== "object") {
      throw new Error(`template ${template.candidateTemplateId} is missing freeze_result: ${freezeResultPath}`)
    }
    loaded.push({
      windowId: toText(window?.windowId),
      yearKey: yearKeyFromDateKey(window?.oosDateFrom, `${template.candidateTemplateId} oosDateFrom`),
      oosDateFrom: toText(window?.oosDateFrom),
      oosDateTo: toText(window?.oosDateTo),
      scopeRunId: toText(window?.scopeRunId) || path.basename(scopeRunDir),
      selectionLineId: toText(window?.search?.lineId) || null,
      selectionMode: toText(window?.search?.selectionMode) || null,
      selectionLeaderboardPath,
      freezeResultPath,
      frozenCatalogPath: toText(freezeResult?.outPath),
      selectionLeaderboardRows,
    })
  }
  return loaded
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const [techniqueContract, templateScreenSummary] = await Promise.all([
    loadTechniqueGrammarContract({
      contractPath: args.contractPath,
      cwd,
    }),
    readJson(args.templateScreenSummaryPath, null),
  ])
  if (!templateScreenSummary || typeof templateScreenSummary !== "object") {
    throw new Error(`Missing template screen summary: ${args.templateScreenSummaryPath}`)
  }
  const selectedTemplates = selectTechniqueYearConsensusTemplates({
    templateScreenSummary,
    selectedTemplateIds: args.templateIds,
  })
  await ensureDir(args.outDir)

  const templateSummaries = []
  const seenTemplateOutDirs = new Set()
  for (const template of selectedTemplates) {
    const rollingSummaryPath = path.resolve(toText(template?.rollingSummaryPath))
    const rollingSummary = await readJson(rollingSummaryPath, null)
    if (!rollingSummary || typeof rollingSummary !== "object") {
      throw new Error(`Missing rolling summary for template ${template.candidateTemplateId}: ${rollingSummaryPath}`)
    }
    const screenWindowArtifacts = await loadScreenWindowArtifacts({
      template,
      rollingSummary,
      cwd,
    })
    const templateSummary = buildTechniqueYearConsensusTemplateSummary({
      template,
      screenWindows: screenWindowArtifacts,
      yearConsensusConfig: techniqueContract.yearConsensus,
    })
    const templateOutDir = path.join(
      args.outDir,
      "templates",
      buildTechniqueTemplateScreenRunSlug({
        value: template.candidateTemplateId,
        maxLength: 96,
      }),
    )
    if (seenTemplateOutDirs.has(templateOutDir)) {
      throw new Error(`Duplicate year-consensus template output dir derived for ${template.candidateTemplateId}: ${templateOutDir}`)
    }
    seenTemplateOutDirs.add(templateOutDir)
    await ensureDir(templateOutDir)
    const consensusRulesPath = path.join(templateOutDir, "consensus_rules.jsonl")
    const consensusRuleIdsPath = path.join(templateOutDir, "consensus_rule_ids.txt")
    const templateSummaryPath = path.join(templateOutDir, "year_consensus_template_summary.json")
    const qualifiedRuleIds = templateSummary.consensusRules
      .filter((row) => row.passConsensus === true)
      .map((row) => row.ruleId)
    await writeJsonl(consensusRulesPath, templateSummary.consensusRules)
    await fs.writeFile(consensusRuleIdsPath, `${qualifiedRuleIds.join("\n")}${qualifiedRuleIds.length > 0 ? "\n" : ""}`, "utf8")
    await writeJson(templateSummaryPath, {
      ...templateSummary,
      consensusRulesPath,
      consensusRuleIdsPath,
    })
    templateSummaries.push({
      ...templateSummary,
      consensusRulesPath,
      consensusRuleIdsPath,
      templateSummaryPath,
    })
  }

  const unionConsensusRuleIds = uniqueSortedStrings(
    templateSummaries.flatMap((templateSummary) =>
      templateSummary.consensusRules
        .filter((row) => row.passConsensus === true)
        .map((row) => row.ruleId),
    ),
  )
  const unionConsensusRuleIdsPath = path.join(args.outDir, "consensus_rule_ids.txt")
  await fs.writeFile(
    unionConsensusRuleIdsPath,
    `${unionConsensusRuleIds.join("\n")}${unionConsensusRuleIds.length > 0 ? "\n" : ""}`,
    "utf8",
  )

  const summaryPath = path.join(args.outDir, "year_consensus_summary.json")
  const summary = {
    kind: TECHNIQUE_YEAR_CONSENSUS_SUMMARY_KIND,
    generatedAt: new Date().toISOString(),
    contractId: toText(techniqueContract.contractId),
    contractPath: toText(techniqueContract.contractPath),
    templateScreenSummaryPath: args.templateScreenSummaryPath,
    templateScreenRunId: toText(templateScreenSummary?.runId),
    sourceBankId: toText(templateScreenSummary?.sourceBankId),
    yearConsensusConfig: { ...techniqueContract.yearConsensus },
    selectedTemplateCount: selectedTemplates.length,
    consensusTemplateCount: templateSummaries.length,
    unionConsensusRuleCount: unionConsensusRuleIds.length,
    unionConsensusRuleIdsPath,
    status: unionConsensusRuleIds.length > 0 ? "ready_for_t5" : "no_consensus_rules",
    templates: templateSummaries.map((templateSummary) => ({
      candidateTemplateId: templateSummary.candidateTemplateId,
      bankId: templateSummary.bankId,
      mechanismId: templateSummary.mechanismId,
      scopeId: templateSummary.scopeId,
      lookbackCandidateId: templateSummary.lookbackCandidateId,
      childRunId: templateSummary.childRunId,
      rollingSummaryPath: templateSummary.rollingSummaryPath,
      rollingReportPath: templateSummary.rollingReportPath,
      screenWindowCount: templateSummary.screenWindowCount,
      screenWindowYears: templateSummary.screenWindowYears,
      consensusCandidateCount: templateSummary.consensusCandidateCount,
      consensusRuleCount: templateSummary.consensusRuleCount,
      topConsensusRuleId: templateSummary.topConsensusRuleId,
      topConsensusRuleIds: templateSummary.topConsensusRuleIds,
      readyForExactRefinement: templateSummary.readyForExactRefinement,
      selectionLineIds: templateSummary.selectionLineIds,
      selectionModes: templateSummary.selectionModes,
      consensusRulesPath: templateSummary.consensusRulesPath,
      consensusRuleIdsPath: templateSummary.consensusRuleIdsPath,
      templateSummaryPath: templateSummary.templateSummaryPath,
    })),
  }
  await writeJson(summaryPath, summary)

  const operatingBridgeManifestPath = path.join(args.outDir, "operating_bridge_manifest.json")
  const operatingBridgeManifest = buildTechniqueOperatingBridgeManifest({
    contractId: techniqueContract.contractId,
    sourceBankId: templateScreenSummary?.sourceBankId,
    templateScreenRunId: templateScreenSummary?.runId,
    templateScreenSummaryPath: args.templateScreenSummaryPath,
    yearConsensusSummaryPath: summaryPath,
    templateSummaries,
    unionConsensusRuleIds,
  })
  await writeJson(operatingBridgeManifestPath, operatingBridgeManifest)

  console.log(
    JSON.stringify(
      {
        outDir: args.outDir,
        selectedTemplateCount: summary.selectedTemplateCount,
        consensusTemplateCount: summary.consensusTemplateCount,
        unionConsensusRuleCount: summary.unionConsensusRuleCount,
        status: summary.status,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
