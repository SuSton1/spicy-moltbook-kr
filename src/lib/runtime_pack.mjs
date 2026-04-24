import fs from "node:fs"
import readline from "node:readline"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const normalizeSeqRef = (value) => {
  if (Array.isArray(value)) return value
  if (ArrayBuffer.isView(value)) return Array.from(value, (v) => num(v) ?? 0)
  return []
}

export const makeDecisionSeedKey = ({ symbol, decisionIdx, asOfIdx, targetIdx }) =>
  [
    String(symbol ?? "").trim(),
    Number.isInteger(decisionIdx) ? decisionIdx : "",
    Number.isInteger(asOfIdx) ? asOfIdx : "",
    Number.isInteger(targetIdx) ? targetIdx : ""
  ].join(":")

export const toFeaturePackRow = ({
  decisionDateKey,
  symbol,
  name,
  asOfDateKey,
  decisionIdx,
  asOfIdx,
  targetIdx,
  featureVec,
  globalFeatureVec,
  eventFeatureVec,
  marketContextVec,
  xsecEventVec,
  contextualTokens,
  seq40,
  seq150,
  localWindow,
  globalWindow
}) => ({
  decisionDateKey: String(decisionDateKey ?? "").trim(),
  symbol: String(symbol ?? "").trim(),
  name: String(name ?? symbol ?? "").trim(),
  asOfDateKey: String(asOfDateKey ?? "").trim(),
  decisionIdx: Number.isInteger(decisionIdx) ? decisionIdx : null,
  asOfIdx: Number.isInteger(asOfIdx) ? asOfIdx : null,
  targetIdx: Number.isInteger(targetIdx) ? targetIdx : null,
  seedKey: makeDecisionSeedKey({ symbol, decisionIdx, asOfIdx, targetIdx }),
  featureVec: featureVec ?? {},
  globalFeatureVec: globalFeatureVec ?? {},
  eventFeatureVec: eventFeatureVec ?? {},
  marketContextVec: marketContextVec ?? {},
  xsecEventVec: xsecEventVec ?? {},
  contextualTokens: Array.isArray(contextualTokens) ? contextualTokens : [],
  seq40: normalizeSeqRef(seq40),
  seq150: normalizeSeqRef(seq150),
  localWindow: Number.isInteger(localWindow) ? localWindow : null,
  globalWindow: Number.isInteger(globalWindow) ? globalWindow : null
})

export const buildFeaturePackMap = (rows) => {
  const byDate = new Map()
  for (const row of rows ?? []) {
    const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
    if (!decisionDateKey) continue
    const list = byDate.get(decisionDateKey) ?? []
    list.push(row)
    byDate.set(decisionDateKey, list)
  }
  return byDate
}

export const buildFeaturePackLookupByDate = (rowsByDate) => {
  const byDateLookup = new Map()
  for (const [decisionDateKey, list] of rowsByDate.entries()) {
    const lookup = new Map()
    for (const row of list ?? []) {
      const seedKey = String(row?.seedKey ?? "").trim()
      if (!seedKey) continue
      lookup.set(seedKey, row)
    }
    byDateLookup.set(String(decisionDateKey), lookup)
  }
  return byDateLookup
}

export const readFeaturePackLookup = async (filePath, options = {}) => {
  const dateAllowSet = options?.dateAllowSet instanceof Set ? options.dateAllowSet : null
  const lookupOnly = options?.lookupOnly === true
  const byDate = lookupOnly ? null : new Map()
  const lookupByDate = lookupOnly ? new Map() : null
  let rowsCount = 0
  let keptRowsCount = 0
  for await (const line of readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  })) {
    const t = String(line ?? "").trim()
    if (!t) continue
    let row = null
    try {
      row = JSON.parse(t)
    } catch {
      continue
    }
    rowsCount += 1
    const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
    if (!decisionDateKey) continue
    if (dateAllowSet && !dateAllowSet.has(decisionDateKey)) continue
    keptRowsCount += 1
    if (lookupOnly) {
      const key = String(row?.seedKey ?? "").trim()
      if (!key) continue
      const bySeed = lookupByDate.get(decisionDateKey) ?? new Map()
      bySeed.set(key, row)
      lookupByDate.set(decisionDateKey, bySeed)
    } else {
      const list = byDate.get(decisionDateKey) ?? []
      list.push(row)
      byDate.set(decisionDateKey, list)
    }
  }
  return {
    rowsCount,
    keptRowsCount,
    byDate,
    lookupByDate: lookupOnly ? lookupByDate : buildFeaturePackLookupByDate(byDate)
  }
}
