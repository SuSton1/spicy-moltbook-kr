import { normalizeDateKey } from "../ai-date-range.lib.mjs"

const MAX_LABEL_LEN = 120

const trimToLen = (value, maxLen) => {
  if (!value) {
    return ""
  }
  return value.length > maxLen ? value.slice(0, maxLen) : value
}

export const normalizeRegimeTag = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
  if (!raw) {
    return null
  }
  return /^[A-Z_]+$/.test(raw) ? raw : null
}

export const extractRegimeTag = (label) => {
  const raw = String(label ?? "")
  const match = raw.match(/@regime[:=]([A-Z_]+)/i)
  return normalizeRegimeTag(match?.[1] ?? null)
}

export const attachRegimeTag = ({ label, regime }) => {
  const normalizedRegime = normalizeRegimeTag(regime)
  const rawBase = String(label ?? "")
  if (!rawBase || !normalizedRegime) {
    return rawBase || null
  }
  const existing = extractRegimeTag(rawBase)
  if (existing === normalizedRegime) {
    return rawBase
  }

  const base = rawBase.replace(/@regime[:=][A-Z_]+/i, "")
  const suffix = `@regime=${normalizedRegime}`

  const rangeMatch = base.match(/@from=\d{4}-\d{2}-\d{2}@to=\d{4}-\d{2}-\d{2}/)
  if (rangeMatch && Number.isFinite(rangeMatch.index)) {
    const rangeSuffix = rangeMatch[0]
    const prefix = base.slice(0, rangeMatch.index)
    const combinedSuffix = `${rangeSuffix}${suffix}`
    const available = Math.max(0, MAX_LABEL_LEN - combinedSuffix.length)
    const trimmedPrefix = trimToLen(prefix, available)
    return `${trimmedPrefix}${combinedSuffix}`
  }

  const available = Math.max(0, MAX_LABEL_LEN - suffix.length)
  const trimmed = trimToLen(base, available)
  return `${trimmed}${suffix}`
}

export const attachTrainRangeLabel = ({
  baseLabel,
  trainFromDateKey,
  trainToDateKey,
  track,
}) => {
  const from = normalizeDateKey(trainFromDateKey)
  const to = normalizeDateKey(trainToDateKey)
  if (!from || !to) {
    return baseLabel ?? null
  }
  const suffix = `@from=${from}@to=${to}`
  const defaultBase = track ? `train:${track}` : "train"
  const base = baseLabel ? String(baseLabel) : defaultBase
  const available = Math.max(0, MAX_LABEL_LEN - suffix.length)
  const trimmed = trimToLen(base, available)
  return `${trimmed}${suffix}`
}

export const extractTrainRange = (label) => {
  const raw = String(label ?? "")
  const fromMatch = raw.match(/@from=(\d{4}-\d{2}-\d{2})/)
  const toMatch = raw.match(/@to=(\d{4}-\d{2}-\d{2})/)
  const from = normalizeDateKey(fromMatch?.[1])
  const to = normalizeDateKey(toMatch?.[1])
  return {
    trainFromDateKey: from,
    trainToDateKey: to,
  }
}

export const selectPatternVersionLabel = ({
  candidates,
  asOfDateKey,
  latestDateKey,
  preferredLabel,
  preferredVersion,
  preferredRegime,
}) => {
  const asOf = normalizeDateKey(asOfDateKey)
  const latest = normalizeDateKey(latestDateKey)
  const normalizedRegime = normalizeRegimeTag(preferredRegime)
  const items = Array.isArray(candidates) ? candidates : []
  const normalized = items
    .map((row) => ({
      version: Number(row?.version ?? 0) || 0,
      versionLabel: row?.versionLabel ?? null,
    }))
    .filter((row) => row.version > 0)

  const byVersion = new Map()
  for (const row of normalized) {
    if (!byVersion.has(row.version)) {
      byVersion.set(row.version, row)
    }
  }
  const unique = Array.from(byVersion.values())

  const hasAsOf = Boolean(asOf)
  const isHistorical = Boolean(asOf && latest && asOf < latest)
  const eligible = unique.filter((row) => {
    const { trainToDateKey } = extractTrainRange(row.versionLabel)
    if (trainToDateKey) {
      return !hasAsOf || trainToDateKey <= asOf
    }
    return !isHistorical
  })

  const pickLatest = (list) =>
    list.sort((a, b) => b.version - a.version)[0] ?? null

  if (preferredLabel) {
    const found = unique.find((row) => row.versionLabel === preferredLabel)
    if (found) {
      const { trainToDateKey } = extractTrainRange(found.versionLabel)
      if (!hasAsOf) {
        return { version: found.version, versionLabel: found.versionLabel }
      }
      if (trainToDateKey ? trainToDateKey <= asOf : !isHistorical) {
        return { version: found.version, versionLabel: found.versionLabel }
      }
    }
  }

  if (preferredVersion) {
    const found = unique.find((row) => row.version === preferredVersion)
    if (found) {
      const { trainToDateKey } = extractTrainRange(found.versionLabel)
      if (!hasAsOf) {
        return { version: found.version, versionLabel: found.versionLabel }
      }
      if (trainToDateKey ? trainToDateKey <= asOf : !isHistorical) {
        return { version: found.version, versionLabel: found.versionLabel }
      }
    }
  }

  if (normalizedRegime) {
    const matched = eligible.filter(
      (row) => extractRegimeTag(row.versionLabel) === normalizedRegime,
    )
    const pickedMatched = pickLatest(matched)
    if (pickedMatched) {
      return {
        version: pickedMatched.version,
        versionLabel: pickedMatched.versionLabel,
      }
    }
  }

  const picked = pickLatest(eligible)
  if (picked) {
    return { version: picked.version, versionLabel: picked.versionLabel }
  }

  if (isHistorical) {
    return { version: null, versionLabel: null }
  }
  const fallback = pickLatest(unique)
  return fallback
    ? { version: fallback.version, versionLabel: fallback.versionLabel }
    : { version: null, versionLabel: null }
}

export const selectPatternFromPoolCandidates = ({
  poolCandidates,
  track,
  asOfDateKey,
  latestDateKey,
  preferredRegime,
}) => {
  const asOf = normalizeDateKey(asOfDateKey)
  const latest = normalizeDateKey(latestDateKey)
  const normalizedRegime = normalizeRegimeTag(preferredRegime)
  const requiredTrack = String(track ?? "")
    .trim()
    .toUpperCase()
  const isHistorical = Boolean(asOf && latest && asOf < latest)
  const rows = Array.isArray(poolCandidates) ? poolCandidates : []
  const normalized = rows
    .map((row) => {
      const rowTrack = String(row?.track ?? "")
        .trim()
        .toUpperCase()
      if (!rowTrack || rowTrack !== requiredTrack) return null
      const state = String(row?.state ?? "")
        .trim()
        .toUpperCase()
      if (state === "QUARANTINED" || state === "DROPPED") return null
      const version = Number(row?.version ?? 0) || 0
      const versionLabel = String(row?.versionLabel ?? "").trim() || null
      if (version <= 0 && !versionLabel) return null
      const fromPayload = normalizeDateKey(row?.trainToDateKey)
      const fromLabel = extractTrainRange(versionLabel).trainToDateKey
      const trainToDateKey = fromPayload ?? fromLabel ?? null
      const selectedRegimeTag =
        normalizeRegimeTag(row?.regimeTag) ?? extractRegimeTag(versionLabel)
      const regimeMatch = Boolean(
        normalizedRegime && selectedRegimeTag === normalizedRegime,
      )
      const trainRangeValid = trainToDateKey ? !asOf || trainToDateKey <= asOf : !isHistorical
      return {
        version: version > 0 ? version : null,
        versionLabel,
        deployScore: Number(row?.deployScore ?? 0) || 0,
        selectedRegimeTag: selectedRegimeTag ?? null,
        regimeMatch,
        trainToDateKey,
        trainRangeValid,
        passedStage2At: String(row?.passedStage2At ?? "").trim() || null,
        state: state || "BENCH",
      }
    })
    .filter(Boolean)

  if (!normalized.length) {
    return {
      version: null,
      versionLabel: null,
      selectedRegimeTag: null,
      regimeMatch: false,
      poolRank: null,
      selectedFromPool: false,
      reason: "POOL_EMPTY",
    }
  }

  const stateRank = (value) => {
    if (value === "ACTIVE") return 2
    if (value === "BENCH") return 1
    return 0
  }

  const scored = normalized
    .slice()
    .sort((a, b) => {
      if (a.regimeMatch !== b.regimeMatch) {
        return a.regimeMatch ? -1 : 1
      }
      if (a.trainRangeValid !== b.trainRangeValid) {
        return a.trainRangeValid ? -1 : 1
      }
      const scoreDiff = b.deployScore - a.deployScore
      if (scoreDiff !== 0) return scoreDiff
      const stateDiff = stateRank(b.state) - stateRank(a.state)
      if (stateDiff !== 0) return stateDiff
      const tsA = Date.parse(a.passedStage2At ?? "") || 0
      const tsB = Date.parse(b.passedStage2At ?? "") || 0
      if (tsB !== tsA) return tsB - tsA
      return (b.version ?? 0) - (a.version ?? 0)
    })

  const picked = scored[0]
  return {
    version: picked.version,
    versionLabel: picked.versionLabel,
    selectedRegimeTag: picked.selectedRegimeTag,
    regimeMatch: picked.regimeMatch,
    trainRangeValid: picked.trainRangeValid,
    poolRank: 1,
    selectedFromPool: true,
    reason: "POOL_SCORING",
  }
}
