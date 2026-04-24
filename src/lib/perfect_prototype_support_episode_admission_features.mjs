const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const augmentEpisode = (episode) => {
  const base = episode?.featureMap ?? {}
  const admissionFeatureMap = {
    "sig.episodeAdm.pathPositiveCarry":
      Number(base["sig.epTransition.pathRecurrenceCarry"] ?? 0) + Number(base["sig.epTransition.node.positiveShare"] ?? 0),
    "sig.episodeAdm.pathNegativePressure": Number(base["sig.epTransition.pathLeakPressure"] ?? 0),
    "sig.episodeAdm.pathCohesion": Number(base["sig.epTransition.pathCohesion"] ?? 0),
    "sig.episodeAdm.pathRecurrenceCarry": Number(base["sig.epTransition.pathRecurrenceCarry"] ?? 0),
    "sig.episodeAdm.pathPrototypeMargin": Number(base["sig.epTransition.pathPrototypeMargin"] ?? 0),
    "sig.episodeAdm.supportProjectionPotential":
      Number(base["sig.epTransition.pathCohesion"] ?? 0) +
      Number(base["sig.epTransition.controlResidual.episodeResidualRank"] ?? 0) +
      Number(base["sig.epTransition.peerAnchorGap.rowWinnerGap"] ?? 0) -
      Number(base["sig.epTransition.pathLeakPressure"] ?? 0),
    "sig.episodeAdm.pathAdmissionScore":
      Number(base["sig.epTransition.pathRecurrenceCarry"] ?? 0) +
      Number(base["sig.epTransition.pathCohesion"] ?? 0) +
      Number(base["sig.epTransition.pathPrototypeMargin"] ?? 0) -
      Number(base["sig.epTransition.pathLeakPressure"] ?? 0),
  }
  return {
    ...episode,
    featureMap: {
      ...base,
      ...admissionFeatureMap,
    },
  }
}

const annotateRows = ({ rows = [], episodeLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const episode = episodeLookup.get(String(row?.dateKey ?? "").trim())
    if (!episode) return row
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    for (const [featureKey, value] of Object.entries(episode.featureMap ?? {})) {
      if (featureKey.startsWith("sig.episodeAdm.")) numericFeatureMap[featureKey] = Number(value ?? 0)
    }
    row.numericFeatureMap = numericFeatureMap
    return row
  })

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.episodeAdm.")),
    ),
  )

export const buildPerfectPrototypeSupportEpisodeAdmissionFeatures = ({ family } = {}) => {
  const trainEpisodeSummaries = (family?.trainEpisodeSummaries ?? []).map((episode) => augmentEpisode(episode))
  const oosEpisodeSummaries = (family?.oosEpisodeSummaries ?? []).map((episode) => augmentEpisode(episode))
  const supportEpisodeSummaries = (family?.supportEpisodeSummaries ?? []).map((episode) => augmentEpisode(episode))
  const trainLookup = new Map(trainEpisodeSummaries.map((episode) => [episode.dateKey, episode]))
  const oosLookup = new Map(oosEpisodeSummaries.map((episode) => [episode.dateKey, episode]))
  const supportLookup = new Map(supportEpisodeSummaries.map((episode) => [episode.dateKey, episode]))
  const fitTrainRows = annotateRows({ rows: family?.fitTrainRows ?? [], episodeLookup: trainLookup })
  const fitGatedTrainRows = annotateRows({ rows: family?.fitGatedTrainRows ?? [], episodeLookup: trainLookup })
  const oosRows = annotateRows({ rows: family?.oosRows ?? [], episodeLookup: oosLookup })
  const supportCaseViews = annotateRows({ rows: family?.supportCaseViews ?? [], episodeLookup: supportLookup })
  const fitLookup = new Map(fitGatedTrainRows.map((row) => [row?.rowKey, row]))
  const fitBridgePositiveRows = (family?.fitBridgePositiveRows ?? []).map((row) => fitLookup.get(row?.rowKey) ?? row)
  const fitSupportNearHardNegativeRows = (family?.fitSupportNearHardNegativeRows ?? []).map(
    (row) => fitLookup.get(row?.rowKey) ?? row,
  )
  const admissionFeatureKeys = collectFeatureKeys([...fitTrainRows, ...oosRows, ...supportCaseViews])
  const ok = admissionFeatureKeys.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_episode_admission_features",
    fitTrainRows,
    fitGatedTrainRows,
    fitBridgePositiveRows,
    fitSupportNearHardNegativeRows,
    oosRows,
    supportCaseViews,
    trainEpisodeSummaries,
    oosEpisodeSummaries,
    supportEpisodeSummaries,
    admissionFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      episodeAdmissionFeatureReady: ok,
      episodeAdmissionFeatureCount: admissionFeatureKeys.length,
    },
  }
}
