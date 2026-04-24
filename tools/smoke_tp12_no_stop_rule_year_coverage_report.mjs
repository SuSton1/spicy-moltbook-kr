#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadTp12NoStopLb5Year2x7ResearchContract } from "../src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"
import { buildPerfectPrototypeYearCoverageAuditFromMatches } from "../src/lib/perfect_prototype_year_coverage.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoStopLb5Year2x7ResearchContract({ cwd })
  const outDir = path.join(cwd, "artifacts", "checks", "smoke_tp12_no_stop_rule_year_coverage_report")
  await ensureDir(outDir)

  const trainMatchesPath = path.join(outDir, "matches.jsonl")
  const catalogPath = path.join(outDir, "catalog.json")
  const matches = []
  for (const year of contract.yearCoverage.coreYears) {
    matches.push({
      decisionDateKey: `${year}-01-15`,
      symbol: `AAA${year}`,
      outcomeHitTarget: true,
      matchedRuleIds: ["PP_PASS"],
    })
    matches.push({
      decisionDateKey: `${year}-07-15`,
      symbol: `BBB${year}`,
      outcomeHitTarget: true,
      matchedRuleIds: ["PP_PASS"],
    })
  }
  matches.push({ decisionDateKey: "2016-10-10", symbol: "PRE2016", outcomeHitTarget: true, matchedRuleIds: ["PP_PASS"] })
  matches.push({ decisionDateKey: "2024-03-20", symbol: "EDGE2024", outcomeHitTarget: true, matchedRuleIds: ["PP_PASS"] })
  matches.push({ decisionDateKey: "2017-02-01", symbol: "FAIL2017A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2017-08-01", symbol: "FAIL2017B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2018-02-01", symbol: "FAIL2018A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2018-08-01", symbol: "FAIL2018B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2020-02-01", symbol: "FAIL2020A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2020-08-01", symbol: "FAIL2020B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2021-02-01", symbol: "FAIL2021A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2021-08-01", symbol: "FAIL2021B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2022-02-01", symbol: "FAIL2022A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2022-08-01", symbol: "FAIL2022B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2023-02-01", symbol: "FAIL2023A", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  matches.push({ decisionDateKey: "2023-08-01", symbol: "FAIL2023B", outcomeHitTarget: true, matchedRuleIds: ["PP_FAIL"] })
  await writeJsonl(trainMatchesPath, matches)
  await writeJson(catalogPath, {
    rules: [
      {
        ruleId: "PP_PASS",
        tokens: ["feat.pass"],
        trainHitCount: 16,
        trainNegativeCount: 0,
      },
      {
        ruleId: "PP_FAIL",
        tokens: ["feat.fail"],
        trainHitCount: 12,
        trainNegativeCount: 0,
      },
    ],
  })

  const catalog = await readJson(catalogPath, null)
  const trainMatches = await readJsonl(trainMatchesPath, { strict: true })
  const audit = buildPerfectPrototypeYearCoverageAuditFromMatches({
    catalog,
    matches: trainMatches,
    coreYears: contract.yearCoverage.coreYears,
    minHitsPerCoreYear: contract.yearCoverage.minHitsPerCoreYear,
  })

  assert.equal(audit.summary.totalRuleCount, 2)
  assert.equal(audit.summary.survivorRuleCount, 1)
  assert.deepEqual(audit.summary.survivorRuleIds, ["PP_PASS"])
  const passRow = audit.rows.find((row) => row.ruleId === "PP_PASS")
  const failRow = audit.rows.find((row) => row.ruleId === "PP_FAIL")
  assert.equal(passRow?.passesMinHitsPerCoreYear, true)
  assert.equal(passRow?.coreYearHitCounts?.["2017"], 2)
  assert.equal(passRow?.coreYearHitCounts?.["2023"], 2)
  assert.equal(failRow?.passesMinHitsPerCoreYear, false)
  assert.ok(Array.isArray(failRow?.violatingYears) && failRow.violatingYears.includes(2019))
  console.log("ok smoke_tp12_no_stop_rule_year_coverage_report")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
