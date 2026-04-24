import { matchesPerfectPrototypeOverlayFailureRule } from "./perfect_prototype_overlay_failure_bank.mjs"
import { matchesPerfectPrototypeOverlayVetoRule } from "./perfect_prototype_overlay_veto_bank.mjs"

const summarizeRows = (rows = []) => {
  const hits = rows.filter((row) => row?.outcomeHitTarget === true)
  const falsePositives = rows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRows: rows.length,
    hitRows: hits.length,
    falsePositiveRows: falsePositives.length,
    precision: rows.length > 0 ? hits.length / rows.length : 0,
    selectedDateCount: new Set(rows.map((row) => row?.dateKey).filter(Boolean)).size,
    hitDateCount: new Set(hits.map((row) => row?.dateKey).filter(Boolean)).size,
  }
}

const applyFailureBank = ({ rows = [], failureBank } = {}) => {
  const rules = Array.isArray(failureBank?.qualifiedRules) ? failureBank.qualifiedRules : []
  if (rules.length < 1) return Array.isArray(rows) ? rows.slice() : []
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => !rules.some((rule) => matchesPerfectPrototypeOverlayFailureRule(row, rule)),
  )
}

const applyVetoBank = ({ rows = [], vetoBank } = {}) => {
  const rules = Array.isArray(vetoBank?.qualifiedRules) ? vetoBank.qualifiedRules : []
  if (rules.length < 1) return Array.isArray(rows) ? rows.slice() : []
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => !rules.some((rule) => matchesPerfectPrototypeOverlayVetoRule(row, rule)),
  )
}

const buildDelta = ({ before = {}, after = {} } = {}) => ({
  selectedRowDelta: Number(after?.selectedRows ?? 0) - Number(before?.selectedRows ?? 0),
  hitRowDelta: Number(after?.hitRows ?? 0) - Number(before?.hitRows ?? 0),
  falsePositiveDelta: Number(after?.falsePositiveRows ?? 0) - Number(before?.falsePositiveRows ?? 0),
  precisionLift: Number(after?.precision ?? 0) - Number(before?.precision ?? 0),
})

export const buildPerfectPrototypeOverlayOosReport = ({
  baselineRows = [],
  failureBank,
  vetoBank,
  baselineOk = true,
  baselineReason = null,
} = {}) => {
  const safeBaselineRows = Array.isArray(baselineRows) ? baselineRows : []
  if (baselineOk !== true || safeBaselineRows.length < 1) {
    return {
      ok: false,
      reason: baselineReason ?? "invalid_or_inconclusive",
      baselineValid: false,
      positiveOnly: summarizeRows([]),
      positivePlusFailure: summarizeRows([]),
      positivePlusFailurePlusVeto: summarizeRows([]),
      failureDelta: buildDelta({ before: summarizeRows([]), after: summarizeRows([]) }),
      vetoDelta: buildDelta({ before: summarizeRows([]), after: summarizeRows([]) }),
      finalAssessment: "invalid_or_inconclusive",
    }
  }

  const positiveOnly = summarizeRows(safeBaselineRows)
  const positivePlusFailureRows = applyFailureBank({
    rows: safeBaselineRows,
    failureBank,
  })
  const positivePlusFailurePlusVetoRows = applyVetoBank({
    rows: positivePlusFailureRows,
    vetoBank,
  })
  const positivePlusFailure = summarizeRows(positivePlusFailureRows)
  const positivePlusFailurePlusVeto = summarizeRows(positivePlusFailurePlusVetoRows)
  const failureDelta = buildDelta({
    before: positiveOnly,
    after: positivePlusFailure,
  })
  const vetoDelta = buildDelta({
    before: positivePlusFailure,
    after: positivePlusFailurePlusVeto,
  })

  let finalAssessment = "positive_only_best"
  if (failureDelta.precisionLift > 0) finalAssessment = "failure_bank_lift"
  if (vetoDelta.precisionLift > 0) finalAssessment = "veto_bank_lift"
  if (positivePlusFailurePlusVeto.selectedRows < 1) finalAssessment = "overpruned"

  return {
    ok: true,
    reason: null,
    baselineValid: true,
    positiveOnly,
    positivePlusFailure,
    positivePlusFailurePlusVeto,
    failureDelta,
    vetoDelta,
    finalAssessment,
  }
}
