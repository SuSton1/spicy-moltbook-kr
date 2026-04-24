import { buildPerfectPrototypeOverlayOosReport } from "./perfect_prototype_overlay_oos_report.mjs"

const applyPositiveBank = ({ rows = [], positiveBank } = {}) => {
  const rules = Array.isArray(positiveBank?.qualifiedRules) ? positiveBank.qualifiedRules : []
  if (rules.length < 1) return []
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    rules.some((rule) => Array.isArray(rule?.ruleTokens) && rule.ruleTokens.every((token) => row?.tokenSet?.has(token) === true)),
  )
}

export const buildPerfectPrototype1dRegimeOosReport = ({
  cellDataset,
  positiveBank,
  failureBank,
  vetoBank,
} = {}) => {
  const positiveOnlyRows = applyPositiveBank({
    rows: cellDataset?.oosRows ?? [],
    positiveBank,
  })
  const report = buildPerfectPrototypeOverlayOosReport({
    baselineRows: positiveOnlyRows,
    failureBank,
    vetoBank,
    baselineOk: positiveBank?.ok === true,
    baselineReason: positiveBank?.reason ?? "unsat_positive_bank",
  })
  return {
    ...report,
    finalAssessment:
      positiveBank?.ok === true
        ? report.finalAssessment
        : "unsat_positive_bank",
  }
}
