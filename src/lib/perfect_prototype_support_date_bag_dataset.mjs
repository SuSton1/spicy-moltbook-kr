const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((left, right) => left - right)

const summarizeBags = (bags = []) => ({
  bagCount: Array.isArray(bags) ? bags.length : 0,
  matchedDateCount: new Set((bags ?? []).map((bag) => bag?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((bags ?? []).map((bag) => bag?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set((bags ?? []).flatMap((bag) => bag?.foldIds ?? [])).size,
})

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const buildBag = ({ bagId, dateKey, rows = [], label = "unknown" } = {}) => {
  const monthKey = buildMonthKey(dateKey)
  const foldIds = uniqueNumbers(rows.map((row) => row?.foldId))
  const windowIds = uniqueNumbers(rows.map((row) => row?.windowId))
  return {
    bagId,
    label,
    dateKey,
    monthKey,
    foldIds,
    windowIds,
    rowCount: rows.length,
    rows,
  }
}

export const buildPerfectPrototypeSupportDateBagDataset = ({
  family,
  minPositiveBags = 2,
  minNegativeBags = 1,
} = {}) => {
  const gatedTrainRows = Array.isArray(family?.gatedTrainRows) ? family.gatedTrainRows : []
  const positiveDateKeys = new Set(
    (Array.isArray(family?.bridgePositiveRows) ? family.bridgePositiveRows : [])
      .map((row) => String(row?.dateKey ?? "").trim())
      .filter(Boolean),
  )
  const negativeDateKeys = new Set(
    (
      Array.isArray(family?.supportNearHardNegativeRows)
        ? family.supportNearHardNegativeRows
        : Array.isArray(family?.hardNegativeRows)
          ? family.hardNegativeRows
          : []
    )
      .map((row) => String(row?.dateKey ?? "").trim())
      .filter(Boolean),
  )

  const trainByDate = groupRowsByDate(gatedTrainRows)
  const positiveBags = []
  const negativeBags = []
  const unlabeledBags = []
  for (const [dateKey, rows] of Array.from(trainByDate.entries()).sort((left, right) => left[0].localeCompare(right[0]))) {
    if (positiveDateKeys.has(dateKey)) {
      positiveBags.push(buildBag({ bagId: `POS:${dateKey}`, dateKey, rows, label: "positive" }))
      continue
    }
    if (negativeDateKeys.has(dateKey)) {
      negativeBags.push(buildBag({ bagId: `NEG:${dateKey}`, dateKey, rows, label: "negative" }))
      continue
    }
    unlabeledBags.push(buildBag({ bagId: `UNLABELED:${dateKey}`, dateKey, rows, label: "unlabeled" }))
  }

  const supportBags = (Array.isArray(family?.supportCaseViews) ? family.supportCaseViews : []).map((row, index) =>
    buildBag({
      bagId: `SUPPORT:${String(row?.caseId ?? row?.dateKey ?? index).trim()}`,
      dateKey: String(row?.dateKey ?? "").trim(),
      rows: [row],
      label: "support",
    }),
  )

  const summary = {
    ...(family?.summary ?? {}),
    dateBagReady: positiveBags.length >= Math.max(1, Math.floor(Number(minPositiveBags) || 2)) &&
      negativeBags.length >= Math.max(1, Math.floor(Number(minNegativeBags) || 1)),
    positiveBagSummary: summarizeBags(positiveBags),
    negativeBagSummary: summarizeBags(negativeBags),
    unlabeledBagSummary: summarizeBags(unlabeledBags),
    supportBagSummary: summarizeBags(supportBags),
    positiveBagCount: positiveBags.length,
    negativeBagCount: negativeBags.length,
    unlabeledBagCount: unlabeledBags.length,
    supportBagCount: supportBags.length,
  }

  if (positiveBags.length < Math.max(1, Math.floor(Number(minPositiveBags) || 2))) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_positive_date_bags",
      positiveBags,
      negativeBags,
      unlabeledBags,
      supportBags,
      summary: {
        ...summary,
        dateBagReady: false,
        dateBagReason: "unsat_no_positive_date_bags",
      },
    }
  }
  if (negativeBags.length < Math.max(1, Math.floor(Number(minNegativeBags) || 1))) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_negative_date_bags",
      positiveBags,
      negativeBags,
      unlabeledBags,
      supportBags,
      summary: {
        ...summary,
        dateBagReady: false,
        dateBagReason: "unsat_no_negative_date_bags",
      },
    }
  }

  return {
    ...family,
    ok: true,
    reason: null,
    positiveBags,
    negativeBags,
    unlabeledBags,
    supportBags,
    summary,
  }
}
