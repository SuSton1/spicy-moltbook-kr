import { enrichPerfectPrototypeRowsWithContext } from "./perfect_prototype_contextual_features.mjs"
import { enrichPerfectPrototypeRowsWithDecisionContext } from "./perfect_prototype_decision_contextual_features.mjs"
import { isPrejumpPredictiveSurface, assertNoPrejumpLeakageRows } from "./perfect_prototype_prejump_contract.mjs"
import { normalizePerfectPrototypeRow, tokenizePerfectPrototypeRow } from "./perfect_prototype_tokenizer.mjs"

const normalizeText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const firstText = (...values) => {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return null
}

const LOW_SUBTYPE_FAMILY_IDS = new Set([
  "low_gap_top_continuation",
  "low_gap_high_continuation",
  "low_jump_below_continuation",
])

const buildRowKey = (row, normalizedRow) =>
  firstText(
    row?.rowKey,
    row?.sourceId,
    normalizedRow?.sourceId,
    [
      normalizeText(normalizedRow?.dateKey ?? row?.dateKey),
      normalizeText(normalizedRow?.symbol ?? row?.symbol),
    ].join("::"),
  )

const normalizeToken = (value) => String(value ?? "").trim().toLowerCase()

const hasToken = (tokenSet, token) => tokenSet.has(normalizeToken(token))

const enrichRowsForCatalogSurface = ({ rows, catalog }) => {
  const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  if (isPrejumpPredictiveSurface(surface)) {
    assertNoPrejumpLeakageRows(rows)
    return enrichPerfectPrototypeRowsWithDecisionContext(rows, {
      referenceRows: rows,
      preserveExisting: true,
    })
  }
  return enrichPerfectPrototypeRowsWithContext(rows, {
    referenceRows: rows,
    replaceExistingContextualTokens: true,
  })
}

const resolveOutcomeHitTarget = (row, normalizedRow) => {
  if (typeof normalizedRow?.outcomeHitTarget === "boolean") return normalizedRow.outcomeHitTarget
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return false
}

const classifyRegimeBucket = (tokenSet) => {
  if (hasToken(tokenSet, "tag:xsec.closeRank:TOP")) return "TOP"
  if (hasToken(tokenSet, "tag:xsec.closeRank:MID")) return "MID"
  if (hasToken(tokenSet, "tag:xsec.closeRank:LOW")) return "LOW"
  return null
}

export const buildPerfectPrototypeRegimeDonorCohortDataset = ({
  rows = [],
  donorRows = [],
  catalog,
  lineId = null,
} = {}) => {
  const ruleFamilyLookup = new Map(
    (Array.isArray(catalog?.rules) ? catalog.rules : []).map((rule) => [String(rule?.ruleId ?? "").trim(), String(rule?.familyId ?? "").trim()]),
  )
  const donorLookup = new Map()
  for (const donorRow of Array.isArray(donorRows) ? donorRows : []) {
    const donorKey = firstText(
      donorRow?.rowKey,
      donorRow?.sourceId,
      donorRow?.matchRowKey,
      [
        normalizeText(donorRow?.recommendationDateKey ?? donorRow?.dateKey),
        normalizeText(donorRow?.symbol),
      ].join("::"),
    )
    if (!donorKey) continue
    const donorFamilyIds = uniqueSorted((donorRow?.matchedRuleIds ?? []).map((ruleId) => ruleFamilyLookup.get(String(ruleId ?? "").trim())).filter(Boolean))
    donorLookup.set(donorKey, {
      donorRow,
      donorFamilyIds,
    })
  }

  const contextualizedRows = enrichRowsForCatalogSurface({
    rows,
    catalog,
  })
  const datasetRows = []
  for (const rawRow of Array.isArray(contextualizedRows) ? contextualizedRows : []) {
    const normalizedRow = normalizePerfectPrototypeRow(rawRow, catalog?.tokenizerSpec?.options)
    if (!normalizedRow?.dateKey || !normalizedRow?.symbol) continue
    const tokenSet = new Set(
      Array.from(tokenizePerfectPrototypeRow(normalizedRow, catalog?.tokenizerSpec)).map((token) => normalizeToken(token)),
    )
    const rowKey = buildRowKey(rawRow, normalizedRow)
    if (!rowKey) continue
    const donor = donorLookup.get(rowKey) ?? donorLookup.get(`${normalizeText(normalizedRow.dateKey)}::${normalizeText(normalizedRow.symbol)}`) ?? null
    const donorFamilyIds = uniqueSorted(donor?.donorFamilyIds)
    const lowSubtypeFamilyIds = donorFamilyIds.filter((familyId) => LOW_SUBTYPE_FAMILY_IDS.has(familyId))
    datasetRows.push({
      rowKey,
      dateKey: normalizeText(normalizedRow.dateKey),
      monthKey:
        normalizeText(rawRow?.monthKey) ||
        (String(normalizedRow.dateKey).length >= 7 ? String(normalizedRow.dateKey).slice(0, 7) : null),
      foldId: Number(rawRow?.foldId ?? 0) || null,
      windowId: Number(rawRow?.windowId ?? 0) || null,
      symbol: normalizeText(normalizedRow.symbol),
      lineId: normalizeText(lineId),
      outcomeHitTarget: resolveOutcomeHitTarget(rawRow, normalizedRow),
      donorSelected: donor != null,
      donorFamilyIds,
      lowSubtypeFamilyIds,
      regimeBucket: classifyRegimeBucket(tokenSet),
      categoricalTokens: Array.from(tokenSet.values()).sort((left, right) => left.localeCompare(right)),
      tokenSet,
    })
  }

  const summary = {
    lineId: normalizeText(lineId),
    totalRows: datasetRows.length,
    donorSelectedRows: datasetRows.filter((row) => row.donorSelected === true).length,
    regimeCounts: {
      TOP: datasetRows.filter((row) => row.regimeBucket === "TOP").length,
      MID: datasetRows.filter((row) => row.regimeBucket === "MID").length,
      LOW: datasetRows.filter((row) => row.regimeBucket === "LOW").length,
      UNKNOWN: datasetRows.filter((row) => !row.regimeBucket).length,
    },
    donorRegimeCounts: {
      TOP: datasetRows.filter((row) => row.donorSelected === true && row.regimeBucket === "TOP").length,
      MID: datasetRows.filter((row) => row.donorSelected === true && row.regimeBucket === "MID").length,
      LOW: datasetRows.filter((row) => row.donorSelected === true && row.regimeBucket === "LOW").length,
    },
    donorLowSubtypeCounts: {
      low_gap_top_continuation: datasetRows.filter(
        (row) => row.donorSelected === true && row.lowSubtypeFamilyIds.includes("low_gap_top_continuation"),
      ).length,
      low_gap_high_continuation: datasetRows.filter(
        (row) => row.donorSelected === true && row.lowSubtypeFamilyIds.includes("low_gap_high_continuation"),
      ).length,
      low_jump_below_continuation: datasetRows.filter(
        (row) => row.donorSelected === true && row.lowSubtypeFamilyIds.includes("low_jump_below_continuation"),
      ).length,
    },
  }

  return {
    rows: datasetRows,
    summary,
  }
}
