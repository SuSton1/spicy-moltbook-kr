const normalizeTraceArray = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b))

const pickPrimarySelectedCandidate = ({ d1Row, d2Row }) => {
  const selectedCandidates = Array.isArray(d2Row?.selectedCandidates) ? d2Row.selectedCandidates : []
  if (selectedCandidates.length < 1) return null
  const pickedSymbols = normalizeTraceArray(d1Row?.pickedSymbols)
  const selectedSymbolSet = new Set(pickedSymbols)
  return selectedCandidates.find((row) => selectedSymbolSet.has(String(row?.symbol ?? "").trim())) ??
    selectedCandidates[0]
}

export const buildTraceSnapshot = ({ decisionDateKey, dayTypeDecision, d1, d2 }) => {
  const selectedRows = Array.isArray(d1?.picks) ? d1.picks : []
  const selected = selectedRows[0] ?? null
  const executedRows = Array.isArray(d2?.executedPicks) ? d2.executedPicks : []
  return {
    decisionDateKey: String(decisionDateKey ?? ""),
    dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
    dayTypeNoTrade: dayTypeDecision?.noTrade === true,
    dayTypeGateReason: dayTypeDecision?.gateReason ?? null,
    dayTypePolicySource: dayTypeDecision?.policySource ?? null,
    top1Symbol: String(d1?.top?.[0]?.symbol ?? "") || null,
    top1AgreementDecision: d1?.top?.[0]?.agreementDecision ?? null,
    top1AgreementReason: d1?.top?.[0]?.agreementReason ?? null,
    gateReason: String(d1?.gate?.gateReason ?? "UNKNOWN"),
    selectedSymbols: normalizeTraceArray(selectedRows.map((row) => row?.symbol)),
    executedSymbols: normalizeTraceArray(executedRows.map((row) => row?.symbol)),
    executionDecision: selected?.executionDecision ?? null,
    executionReason: selected?.executionShadowReason ?? null,
    falsePositiveDecision: selected?.falsePositiveDecision ?? null,
    falsePositiveReason: selected?.falsePositiveReason ?? null,
    budgetDecision: selected?.budgetDecision ?? null,
    budgetReason: selected?.budgetReason ?? null
  }
}

export const buildTraceSnapshotFromAuditRows = ({
  decisionDateKey,
  d1Row,
  d2Row
}) => {
  const selected = pickPrimarySelectedCandidate({ d1Row, d2Row })
  return {
    decisionDateKey: String(decisionDateKey ?? d1Row?.decisionDateKey ?? d2Row?.decisionDateKey ?? ""),
    dayType: String(d1Row?.dayType ?? d2Row?.dayType ?? "BALANCED"),
    dayTypeNoTrade: d1Row?.dayTypeNoTrade === true || d2Row?.dayTypeNoTrade === true,
    dayTypeGateReason: d1Row?.dayTypeGateReason ?? d2Row?.dayTypeGateReason ?? null,
    dayTypePolicySource: d1Row?.dayTypePolicySource ?? d2Row?.dayTypePolicySource ?? null,
    top1Symbol: String(d1Row?.top1Symbol ?? "") || null,
    top1AgreementDecision: d1Row?.top1AgreementDecision ?? null,
    top1AgreementReason: d1Row?.top1AgreementReason ?? null,
    gateReason: String(d1Row?.gateReason ?? d2Row?.gateReason ?? "UNKNOWN"),
    selectedSymbols: normalizeTraceArray(d1Row?.pickedSymbols),
    executedSymbols: normalizeTraceArray(d2Row?.executedSymbols),
    executionDecision: selected?.executionDecision ?? null,
    executionReason: selected?.executionShadowReason ?? null,
    falsePositiveDecision: selected?.falsePositiveDecision ?? null,
    falsePositiveReason: selected?.falsePositiveReason ?? null,
    budgetDecision: selected?.budgetDecision ?? null,
    budgetReason: selected?.budgetReason ?? null
  }
}

export const compareTraceSnapshots = ({ primary, baseline }) => {
  const fields = [
    "dayType",
    "dayTypeNoTrade",
    "dayTypeGateReason",
    "dayTypePolicySource",
    "top1Symbol",
    "top1AgreementDecision",
    "top1AgreementReason",
    "gateReason",
    "executionDecision",
    "executionReason",
    "falsePositiveDecision",
    "falsePositiveReason",
    "budgetDecision",
    "budgetReason"
  ]
  const criticalFields = new Set([
    "dayType",
    "dayTypeNoTrade",
    "top1Symbol",
    "gateReason",
    "executionDecision",
    "falsePositiveDecision",
    "budgetDecision"
  ])
  const mismatches = []
  for (const field of fields) {
    const left = primary?.[field] ?? null
    const right = baseline?.[field] ?? null
    if (left !== right) {
      mismatches.push({
        field,
        primary: left,
        baseline: right,
        critical: criticalFields.has(field)
      })
    }
  }
  const primarySelected = normalizeTraceArray(primary?.selectedSymbols)
  const baselineSelected = normalizeTraceArray(baseline?.selectedSymbols)
  if (primarySelected.join("|") !== baselineSelected.join("|")) {
    mismatches.push({
      field: "selectedSymbols",
      primary: primarySelected,
      baseline: baselineSelected,
      critical: false
    })
  }
  const primaryExecuted = normalizeTraceArray(primary?.executedSymbols)
  const baselineExecuted = normalizeTraceArray(baseline?.executedSymbols)
  if (primaryExecuted.join("|") !== baselineExecuted.join("|")) {
    mismatches.push({
      field: "executedSymbols",
      primary: primaryExecuted,
      baseline: baselineExecuted,
      critical: true
    })
  }
  return {
    mismatch: mismatches.length > 0,
    criticalMismatch: mismatches.some((row) => row.critical === true),
    mismatches
  }
}
