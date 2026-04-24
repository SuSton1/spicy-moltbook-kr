export const PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS = Object.freeze([
  "rootPositiveMode",
  "rootNegativeMode",
])

export const PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS = Object.freeze([
  "seedPositiveSparse",
  "seedPositiveBitset",
  "seedNegativeSparse",
  "seedNegativeBitset",
  "statePositiveSparse",
  "statePositiveBitset",
  "stateNegativeSparse",
  "stateNegativeBitset",
])

export const createPerfectPrototypeRowsetModeStatsShape = () => ({
  rootPositiveMode: null,
  rootNegativeMode: null,
  seedPositiveSparse: 0,
  seedPositiveBitset: 0,
  seedNegativeSparse: 0,
  seedNegativeBitset: 0,
  statePositiveSparse: 0,
  statePositiveBitset: 0,
  stateNegativeSparse: 0,
  stateNegativeBitset: 0,
})

export const normalizePerfectPrototypeRowsetModeStats = (
  rowsetModeStats,
  { label = "rowsetModeStats", strict = false } = {},
) => {
  const source = rowsetModeStats && typeof rowsetModeStats === "object" ? rowsetModeStats : {}
  const normalized = createPerfectPrototypeRowsetModeStatsShape()
  const allowedKeys = new Set([
    ...PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS,
    ...PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS,
  ])
  if (strict) {
    for (const key of Object.keys(source)) {
      if (!allowedKeys.has(key)) {
        throw new Error(`Unexpected ${label}.${key}`)
      }
    }
  }
  for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS) {
    normalized[key] = source[key] == null ? null : String(source[key])
  }
  for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS) {
    normalized[key] = Number(source[key] ?? 0)
  }
  return normalized
}
