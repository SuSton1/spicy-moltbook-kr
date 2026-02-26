const toFiniteNumber = (value) => {
  if (value === null || value === undefined) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toFiniteInt = (value) => {
  const n = toFiniteNumber(value)
  if (n === null) return null
  return Math.floor(n)
}

const toDateString = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

const normalizeTrack = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
  if (raw === "SURGE_EOD" || raw === "GAP_15_BET") {
    return raw
  }
  return null
}

const normalizePoolState = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
  if (raw === "ACTIVE" || raw === "BENCH" || raw === "QUARANTINED") {
    return raw
  }
  if (raw === "DROPPED") {
    return "DROPPED"
  }
  return "BENCH"
}

export const normalizePoolCandidate = (value) => {
  if (!value || typeof value !== "object") {
    return null
  }
  const track = normalizeTrack(value.track)
  const version = toFiniteInt(value.version)
  const versionLabel = String(value.versionLabel ?? "").trim() || null
  if ((!version || version <= 0) && !versionLabel) {
    return null
  }
  const deployScore = toFiniteNumber(value.deployScore) ?? 0
  const state = normalizePoolState(value.state)
  const fingerprint = String(value.fingerprint ?? "").trim() || null
  const candidateId =
    String(value.candidateId ?? "").trim() ||
    `${track ?? "UNKNOWN"}:${versionLabel ?? `v${version ?? 0}`}:${fingerprint ?? "no-fp"}`
  return {
    candidateId,
    track,
    engineType:
      String(value.engineType ?? "")
        .trim()
        .toLowerCase() === "chart"
        ? "chart"
        : "rule",
    version: version && version > 0 ? version : null,
    versionLabel,
    fingerprint,
    deployScore,
    sourceRunId: String(value.sourceRunId ?? "").trim() || null,
    sourceRound: toFiniteInt(value.sourceRound),
    trainFromDateKey: toDateString(value.trainFromDateKey),
    trainToDateKey: toDateString(value.trainToDateKey),
    regimeTag:
      String(value.regimeTag ?? "")
        .trim()
        .toUpperCase() || null,
    passedStage2At: String(value.passedStage2At ?? "").trim() || null,
    state,
    failStreak: Math.max(0, toFiniteInt(value.failStreak) ?? 0),
    lastEvaluatedAt: String(value.lastEvaluatedAt ?? "").trim() || null,
    minAliveProtected: Boolean(value.minAliveProtected),
  }
}

const comparePoolCandidates = (a, b) => {
  const stateRank = (state) => {
    if (state === "ACTIVE") return 3
    if (state === "BENCH") return 2
    if (state === "QUARANTINED") return 1
    return 0
  }
  const scoreDiff =
    (Number(b?.deployScore ?? 0) || 0) - (Number(a?.deployScore ?? 0) || 0)
  if (scoreDiff !== 0) return scoreDiff
  const stateDiff = stateRank(b?.state) - stateRank(a?.state)
  if (stateDiff !== 0) return stateDiff
  const passedA = Date.parse(String(a?.passedStage2At ?? "")) || 0
  const passedB = Date.parse(String(b?.passedStage2At ?? "")) || 0
  if (passedB !== passedA) return passedB - passedA
  const versionA = Number(a?.version ?? 0) || 0
  const versionB = Number(b?.version ?? 0) || 0
  return versionB - versionA
}

export const extractPoolCandidatesFromActiveConfig = (
  activeConfigJson,
  { track = null, includeDropped = false } = {},
) => {
  const list = Array.isArray(activeConfigJson?.poolCandidates)
    ? activeConfigJson.poolCandidates
    : []
  const normalizedTrack = normalizeTrack(track)
  const dedup = new Map()
  for (const row of list) {
    const normalized = normalizePoolCandidate(row)
    if (!normalized) continue
    if (normalizedTrack && normalized.track !== normalizedTrack) continue
    if (!includeDropped && normalized.state === "DROPPED") continue
    const key = [
      normalized.track ?? "",
      normalized.versionLabel ?? "",
      String(normalized.version ?? 0),
      normalized.fingerprint ?? "",
    ].join("|")
    const prev = dedup.get(key)
    if (!prev || comparePoolCandidates(normalized, prev) < 0) {
      dedup.set(key, normalized)
    }
  }
  return Array.from(dedup.values()).sort(comparePoolCandidates)
}

export const selectPrimaryFromPool = ({ poolCandidates, track = null }) => {
  const normalizedTrack = normalizeTrack(track)
  const primarySort = (a, b) => {
    const stateRank = (state) => {
      if (state === "ACTIVE") return 2
      if (state === "BENCH") return 1
      return 0
    }
    const stateDiff = stateRank(b?.state) - stateRank(a?.state)
    if (stateDiff !== 0) return stateDiff
    const scoreDiff =
      (Number(b?.deployScore ?? 0) || 0) - (Number(a?.deployScore ?? 0) || 0)
    if (scoreDiff !== 0) return scoreDiff
    const passedA = Date.parse(String(a?.passedStage2At ?? "")) || 0
    const passedB = Date.parse(String(b?.passedStage2At ?? "")) || 0
    if (passedB !== passedA) return passedB - passedA
    const versionA = Number(a?.version ?? 0) || 0
    const versionB = Number(b?.version ?? 0) || 0
    return versionB - versionA
  }
  const list = Array.isArray(poolCandidates) ? poolCandidates : []
  const eligible = list
    .map((row) => normalizePoolCandidate(row))
    .filter((row) => {
      if (!row) return false
      if (normalizedTrack && row.track !== normalizedTrack) return false
      return row.state !== "QUARANTINED" && row.state !== "DROPPED"
    })
    .sort(primarySort)
  return eligible[0] ?? null
}

export const extractPolicyParamsFromActiveConfig = (activeConfigJson) => {
  const raw = activeConfigJson?.policyParams
  if (!raw || typeof raw !== "object") {
    return null
  }
  const out = {
    candidateCount: toFiniteInt(raw.candidateCount),
    minLiquidity: toFiniteNumber(raw.minLiquidity),
    scoreEps: toFiniteNumber(raw.scoreEps),
    vectorBins: toFiniteInt(raw.vectorBins),
    lookbackDays: toFiniteInt(raw.lookbackDays),
    entryBandPct: toFiniteNumber(raw.entryBandPct),
    stopBandPct: toFiniteNumber(raw.stopBandPct),
    targetBandPct: toFiniteNumber(raw.targetBandPct),
    trailingPct: toFiniteNumber(raw.trailingPct),
    minRewardPct: toFiniteNumber(raw.minRewardPct),
  }
  return out
}

export const resolveCandidatePolicy = ({
  cli,
  cliProvided,
  activePolicyParams,
}) => {
  const provided = cliProvided ?? {}
  const active = activePolicyParams ?? {}
  const fallback = cli ?? {}

  const normalize = (value) => {
    if (value === null || value === undefined) {
      return null
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  const pick = (key) => {
    const cliValue = normalize(fallback[key])
    if (provided[key]) {
      return {
        value: cliValue,
        source: "cli",
      }
    }
    const activeValue = active[key]
    if (Number.isFinite(activeValue)) {
      return { value: activeValue, source: "activeStrategy" }
    }
    return { value: cliValue, source: "default" }
  }

  const minLiquidity = pick("minLiquidity")
  const scoreEps = pick("scoreEps")
  const vectorBins = pick("vectorBins")

  return {
    values: {
      minLiquidity: minLiquidity.value,
      scoreEps: scoreEps.value,
      vectorBins: vectorBins.value,
    },
    sources: {
      minLiquidity: minLiquidity.source,
      scoreEps: scoreEps.source,
      vectorBins: vectorBins.source,
    },
  }
}

export const prependActivePatternCandidate = ({
  candidates,
  activeVersion,
  activeLabel,
}) => {
  const list = Array.isArray(candidates) ? candidates.slice() : []
  const version = Number(activeVersion ?? 0) || 0
  const versionLabel = activeLabel ? String(activeLabel) : null
  if (version > 0 && versionLabel) {
    return [{ version, versionLabel }, ...list]
  }
  return list
}
