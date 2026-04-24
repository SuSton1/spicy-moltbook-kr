#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadTp12NoStopLb5Year2x7ResearchContract } from "../src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"
import { buildPerfectPrototypeYearCoverageAuditFromMatches } from "../src/lib/perfect_prototype_year_coverage.mjs"

const toText = (value) => String(value ?? "").trim()

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const contractPath = toText(
    getFlag(parsed.flags, "contract-path", "meta/tp12_no_stop_lb5_year2x7_research_contract.json"),
  )
  const catalogPath = path.resolve(toText(getFlag(parsed.flags, "catalog", "")))
  const trainMatchesPath = path.resolve(toText(getFlag(parsed.flags, "train-matches", "")))
  const outDir = path.resolve(toText(getFlag(parsed.flags, "out-dir", "")))
  if (!catalogPath || !trainMatchesPath || !outDir) {
    throw new Error(
      "Usage: node tools/build_tp12_no_stop_rule_year_coverage_report.mjs --catalog=<catalog.json> --train-matches=<matches.jsonl> --out-dir=<dir> [--contract-path=PATH]",
    )
  }

  const contract = await loadTp12NoStopLb5Year2x7ResearchContract({
    contractPath,
    cwd,
  })
  const catalog = await readJson(catalogPath, null)
  if (!catalog || typeof catalog !== "object") {
    throw new Error(`Missing catalog JSON: ${catalogPath}`)
  }
  const trainMatches = await readJsonl(trainMatchesPath, { strict: true })
  if (trainMatches.length < 1) {
    throw new Error(`train matches has no rows: ${trainMatchesPath}`)
  }

  const audit = buildPerfectPrototypeYearCoverageAuditFromMatches({
    catalog,
    matches: trainMatches,
    coreYears: contract.yearCoverage.coreYears,
    minHitsPerCoreYear: contract.yearCoverage.minHitsPerCoreYear,
  })

  await ensureDir(outDir)
  const rowsPath = path.join(outDir, "rule_year_coverage.jsonl")
  const survivorRuleIdsPath = path.join(outDir, "year2x7_survivor_rule_ids.txt")
  const summaryPath = path.join(outDir, "year2x7_audit_summary.json")
  await writeJsonl(rowsPath, audit.rows)
  const survivorPayload =
    audit.summary.survivorRuleIds.length > 0 ? `${audit.summary.survivorRuleIds.join("\n")}\n` : ""
  await ensureDir(path.dirname(survivorRuleIdsPath))
  await fs.writeFile(survivorRuleIdsPath, survivorPayload, "utf8")
  await writeJson(summaryPath, {
    kind: "tp12_no_stop_rule_year_coverage_summary_v1",
    contractId: contract.contractId,
    contractPath: contract.contractPath,
    catalogPath,
    trainMatchesPath,
    totalRuleCount: audit.summary.totalRuleCount,
    survivorRuleCount: audit.summary.survivorRuleCount,
    survivorShare: audit.summary.survivorShare,
    coreYears: audit.summary.coreYears,
    minHitsPerCoreYear: audit.summary.minHitsPerCoreYear,
    ruleIdsWithZeroCoreYearHits: audit.summary.ruleIdsWithZeroCoreYearHits,
    ruleIdsBelowTargetButNonZeroCoreYears: audit.summary.ruleIdsBelowTargetButNonZeroCoreYears,
    minObservedCoreYearHitCount: audit.summary.minObservedCoreYearHitCount,
    maxObservedCoreYearHitCount: audit.summary.maxObservedCoreYearHitCount,
    survivorRuleIdsPath,
    rowsPath,
  })
  console.log(
    JSON.stringify({
      outDir,
      summaryPath,
      rowsPath,
      survivorRuleIdsPath,
      survivorRuleCount: audit.summary.survivorRuleCount,
    }),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
