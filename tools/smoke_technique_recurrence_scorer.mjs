#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueRecurrenceReport } from "../src/lib/technique_recurrence_scorer.mjs"

const buildYearRows = ({ templateId, mechanismId, scopeId, lookbackCandidateId, yearKey, hitCount, missCount = 0 }) => {
  const rows = []
  for (let index = 0; index < hitCount; index += 1) {
    const day = String(index + 2).padStart(2, "0")
    rows.push({
      candidateTemplateId: templateId,
      mechanismId,
      bankId: `${mechanismId}__${scopeId}__${lookbackCandidateId}`,
      scopeId,
      lookbackCandidateId,
      decisionDateKey: `${yearKey}-01-${day}`,
      yearKey,
      hitTarget: true,
    })
  }
  for (let index = 0; index < missCount; index += 1) {
    const day = String(index + hitCount + 2).padStart(2, "0")
    rows.push({
      candidateTemplateId: templateId,
      mechanismId,
      bankId: `${mechanismId}__${scopeId}__${lookbackCandidateId}`,
      scopeId,
      lookbackCandidateId,
      decisionDateKey: `${yearKey}-02-${day}`,
      yearKey,
      hitTarget: false,
    })
  }
  return rows
}

const buildSourceRows = ({ years, scopeId, lookbackCandidateId }) =>
  years.flatMap((yearKey) => [
    {
      symbol: `A${yearKey}`,
      decisionDateKey: `${yearKey}-01-02`,
      scopeId,
      lookbackCandidateId,
    },
    {
      symbol: `B${yearKey}`,
      decisionDateKey: `${yearKey}-01-03`,
      scopeId,
      lookbackCandidateId,
    },
    {
      symbol: `C${yearKey}`,
      decisionDateKey: `${yearKey}-02-04`,
      scopeId,
      lookbackCandidateId,
    },
  ])

const buildSourceRowsWithoutScopeLookback = ({ years }) =>
  years.flatMap((yearKey) => [
    {
      symbol: `X${yearKey}`,
      decisionDateKey: `${yearKey}-01-02`,
    },
    {
      symbol: `Y${yearKey}`,
      decisionDateKey: `${yearKey}-01-03`,
    },
    {
      symbol: `Z${yearKey}`,
      decisionDateKey: `${yearKey}-02-04`,
    },
  ])

const main = async () => {
  const contract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  const coreYears = contract.coreYears
  const strongTemplate = {
    candidateTemplateId: "strong_template",
    seedId: "seed_a",
    mechanismId: "MA_RETEST",
    scopeCandidates: ["LOW_GAP_TOP"],
    lookbackCandidateIds: ["lb5"],
  }
  const weakTemplate = {
    candidateTemplateId: "weak_template",
    seedId: "seed_b",
    mechanismId: "BREAKOUT_BASE",
    scopeCandidates: ["TOP"],
    lookbackCandidateIds: ["lb3"],
  }
  const strongEvents = [
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2017,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2018,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2019,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2020,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2021,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2022,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2023,
      hitCount: 2,
    }),
    ...buildYearRows({
      templateId: "strong_template",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      yearKey: 2024,
      hitCount: 1,
    }),
  ]
  const weakEvents = [
    ...buildYearRows({
      templateId: "weak_template",
      mechanismId: "BREAKOUT_BASE",
      scopeId: "TOP",
      lookbackCandidateId: "lb3",
      yearKey: 2022,
      hitCount: 1,
    }),
    ...buildYearRows({
      templateId: "weak_template",
      mechanismId: "BREAKOUT_BASE",
      scopeId: "TOP",
      lookbackCandidateId: "lb3",
      yearKey: 2024,
      hitCount: 1,
    }),
  ]
  const report = buildTechniqueRecurrenceReport({
    techniqueContract: contract,
    templates: [strongTemplate, weakTemplate],
    eventRows: [...strongEvents, ...weakEvents],
    sourceRows: [
      ...buildSourceRows({
        years: coreYears,
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
      }),
      ...buildSourceRows({
        years: coreYears,
        scopeId: "TOP",
        lookbackCandidateId: "lb3",
      }),
    ],
    labelId: "tp12_no_stop_hit_3d",
  })
  assert.equal(report.kind, "technique_recurrence_report_v1")
  const strongSummary = report.templateSummaries.find((item) => item.id === "strong_template")
  const weakSummary = report.templateSummaries.find((item) => item.id === "weak_template")
  assert.equal(strongSummary.yearsWithHitGe2, 7)
  assert.equal(strongSummary.passPromotion, true)
  assert.deepEqual(strongSummary.yearHitVector, [2, 2, 2, 2, 2, 2, 2, 1])
  assert.equal(strongSummary.minYearEventCount, 1)
  assert.equal(weakSummary.passDiscovery, false)
  const strongBank = report.bankSummaries.find((item) => item.id === "MA_RETEST__LOW_GAP_TOP__lb5")
  assert.equal(strongBank.passPromotion, true)

  const reportWithDefaults = buildTechniqueRecurrenceReport({
    techniqueContract: contract,
    templates: [strongTemplate],
    eventRows: [...strongEvents],
    sourceRows: buildSourceRowsWithoutScopeLookback({ years: coreYears }),
    labelId: "tp12_no_stop_hit_3d",
    defaultScopeId: "LOW_GAP_TOP",
    defaultLookbackCandidateId: "lb5",
  })
  const strongSummaryWithDefaults = reportWithDefaults.templateSummaries.find(
    (item) => item.id === "strong_template",
  )
  assert.equal(strongSummaryWithDefaults.decisionDayCount, coreYears.length * 3)
  assert.ok(strongSummaryWithDefaults.signalsPer20TradingDays > 0)
  console.log("ok smoke_technique_recurrence_scorer")
}

await main()
