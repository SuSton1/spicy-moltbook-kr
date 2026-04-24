import { applyPerfectPrototypeSupportEpisodeAdmission } from "./perfect_prototype_support_episode_admission_calibrate.mjs"

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0),
  ).size,
})

const annotateAdmissionFlag = ({ rows = [], admittedDateKeys = new Set() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    numericFeatureMap["sig.episodeAdm.isAdmittedDate"] = admittedDateKeys.has(String(row?.dateKey ?? "").trim()) ? 1 : 0
    row.numericFeatureMap = numericFeatureMap
    return row
  })

const filterRowsByDate = ({ rows = [], admittedDateKeys = new Set() } = {}) =>
  (Array.isArray(rows) ? rows : []).filter((row) => admittedDateKeys.has(String(row?.dateKey ?? "").trim()))

export const buildPerfectPrototypeSupportAdmittedQueryDataset = ({
  family,
  admissionArtifact,
} = {}) => {
  const trainEvaluations = applyPerfectPrototypeSupportEpisodeAdmission({
    artifact: admissionArtifact,
    episodes: family?.trainEpisodeSummaries ?? [],
  })
  const oosEvaluations = applyPerfectPrototypeSupportEpisodeAdmission({
    artifact: admissionArtifact,
    episodes: family?.oosEpisodeSummaries ?? [],
  })
  const supportEvaluations = applyPerfectPrototypeSupportEpisodeAdmission({
    artifact: admissionArtifact,
    episodes: family?.supportEpisodeSummaries ?? [],
  })

  const admittedTrainDateKeys = new Set(
    trainEvaluations.filter((entry) => entry?.selected === true).map((entry) => entry?.episode?.dateKey).filter(Boolean),
  )
  const admittedOosDateKeys = new Set(
    oosEvaluations.filter((entry) => entry?.selected === true).map((entry) => entry?.episode?.dateKey).filter(Boolean),
  )
  const admittedSupportDateKeys = new Set(
    supportEvaluations.filter((entry) => entry?.selected === true).map((entry) => entry?.episode?.dateKey).filter(Boolean),
  )

  const fitTrainRows = annotateAdmissionFlag({
    rows: filterRowsByDate({ rows: family?.fitTrainRows ?? [], admittedDateKeys: admittedTrainDateKeys }),
    admittedDateKeys: admittedTrainDateKeys,
  })
  const fitGatedTrainRows = annotateAdmissionFlag({
    rows: filterRowsByDate({ rows: family?.fitGatedTrainRows ?? [], admittedDateKeys: admittedTrainDateKeys }),
    admittedDateKeys: admittedTrainDateKeys,
  })
  const oosRows = annotateAdmissionFlag({
    rows: filterRowsByDate({ rows: family?.oosRows ?? [], admittedDateKeys: admittedOosDateKeys }),
    admittedDateKeys: admittedOosDateKeys,
  })
  const supportCaseViews = annotateAdmissionFlag({
    rows: filterRowsByDate({ rows: family?.supportCaseViews ?? [], admittedDateKeys: admittedSupportDateKeys }),
    admittedDateKeys: admittedSupportDateKeys,
  })

  const fitLookup = new Map(fitGatedTrainRows.map((row) => [row?.rowKey, row]))
  const fitBridgePositiveRows = (family?.fitBridgePositiveRows ?? [])
    .filter((row) => admittedTrainDateKeys.has(String(row?.dateKey ?? "").trim()))
    .map((row) => fitLookup.get(row?.rowKey) ?? row)
  const fitSupportNearHardNegativeRows = (family?.fitSupportNearHardNegativeRows ?? [])
    .filter((row) => admittedTrainDateKeys.has(String(row?.dateKey ?? "").trim()))
    .map((row) => fitLookup.get(row?.rowKey) ?? row)

  const ok = fitGatedTrainRows.length > 0 && fitBridgePositiveRows.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_admitted_queries",
    trainRows: fitTrainRows,
    gatedTrainRows: fitGatedTrainRows,
    bridgePositiveRows: fitBridgePositiveRows,
    supportNearHardNegativeRows: fitSupportNearHardNegativeRows,
    oosRows,
    supportCaseViews,
    admittedTrainDateKeys: uniqueStrings(Array.from(admittedTrainDateKeys.values())),
    admittedOosDateKeys: uniqueStrings(Array.from(admittedOosDateKeys.values())),
    admittedSupportDateKeys: uniqueStrings(Array.from(admittedSupportDateKeys.values())),
    episodeAdmissionArtifactHash: family?.episodeAdmissionArtifactHash ?? null,
    summary: {
      ...(family?.summary ?? {}),
      admittedQueryReady: ok,
      admittedTrainDateCount: admittedTrainDateKeys.size,
      admittedOosDateCount: admittedOosDateKeys.size,
      admittedSupportDateCount: admittedSupportDateKeys.size,
      admittedTrainSummary: summarizeRows(fitBridgePositiveRows),
      admittedNegativeSummary: summarizeRows(fitSupportNearHardNegativeRows),
      supportProjectionPositive: admittedSupportDateKeys.size > 0,
    },
  }
}
