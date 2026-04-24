import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
  buildPerfectPrototypeRuleFamilyRootTokens,
} from "./perfect_prototype_rule_family_spec.mjs"

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

export const PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP = "TOP_1D"
export const PERFECT_PROTOTYPE_1D_REGIME_CELL_MID = "MID_1D"
export const PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW = "LOW_1D"

const PERFECT_PROTOTYPE_1D_REGIME_CELL_SPECS = Object.freeze([
  Object.freeze({
    cellId: PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP,
    regime: "TOP",
    horizonId: "1D",
    label: "TOP x 1D",
    familyIds: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT,
      PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
    ]),
  }),
  Object.freeze({
    cellId: PERFECT_PROTOTYPE_1D_REGIME_CELL_MID,
    regime: "MID",
    horizonId: "1D",
    label: "MID x 1D",
    familyIds: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION]),
  }),
  Object.freeze({
    cellId: PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW,
    regime: "LOW",
    horizonId: "1D",
    label: "LOW x 1D",
    familyIds: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
    ]),
  }),
]).map((entry) =>
  Object.freeze({
    ...entry,
    familyRootTokens: Object.freeze(
      Object.fromEntries(
        entry.familyIds.map((familyId) => [familyId, buildPerfectPrototypeRuleFamilyRootTokens(familyId)]),
      ),
    ),
    cellRootTokens: Object.freeze(
      uniqueStrings(entry.familyIds.flatMap((familyId) => buildPerfectPrototypeRuleFamilyRootTokens(familyId))),
    ),
  }),
)

const rowTokenSet = (row) =>
  row?.tokenSet instanceof Set
    ? row.tokenSet
    : new Set(
        [
          ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
          ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
        ].filter(Boolean),
      )

export const buildPerfectPrototype1dRegimeCellSpecs = () =>
  PERFECT_PROTOTYPE_1D_REGIME_CELL_SPECS.map((entry) => ({
    ...entry,
    familyIds: Array.from(entry.familyIds),
    familyRootTokens: Object.fromEntries(
      Object.entries(entry.familyRootTokens).map(([familyId, tokens]) => [familyId, Array.from(tokens)]),
    ),
    cellRootTokens: Array.from(entry.cellRootTokens),
  }))

export const resolvePerfectPrototype1dRegimeCellSpec = (cellId) =>
  buildPerfectPrototype1dRegimeCellSpecs().find((entry) => entry.cellId === String(cellId ?? "").trim()) ?? null

export const listPerfectPrototype1dRegimeCellIds = () =>
  PERFECT_PROTOTYPE_1D_REGIME_CELL_SPECS.map((entry) => entry.cellId)

export const matchPerfectPrototype1dRegimeCellFamilyId = ({ row, familyId } = {}) => {
  const rootTokens = buildPerfectPrototypeRuleFamilyRootTokens(familyId)
  if (rootTokens.length < 1) return false
  const tokenSet = rowTokenSet(row)
  return rootTokens.every((token) => tokenSet.has(token))
}

export const matchPerfectPrototype1dRegimeCellRow = ({ row, cellSpec } = {}) => {
  const normalizedCellSpec =
    cellSpec && typeof cellSpec === "object"
      ? cellSpec
      : resolvePerfectPrototype1dRegimeCellSpec(cellSpec)
  if (!normalizedCellSpec) return false
  return normalizedCellSpec.familyIds.some((familyId) =>
    matchPerfectPrototype1dRegimeCellFamilyId({ row, familyId }),
  )
}

export const resolvePerfectPrototype1dRegimeRowFamilyIds = ({ row, cellSpec } = {}) => {
  const normalizedCellSpec =
    cellSpec && typeof cellSpec === "object"
      ? cellSpec
      : resolvePerfectPrototype1dRegimeCellSpec(cellSpec)
  if (!normalizedCellSpec) return []
  return normalizedCellSpec.familyIds.filter((familyId) =>
    matchPerfectPrototype1dRegimeCellFamilyId({ row, familyId }),
  )
}
