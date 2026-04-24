import { isInRange } from "./date.mjs"
import {
  evaluateCoreFilters,
  evaluateGapTradabilityFilter,
  evaluateInstrumentFilter
} from "./filters.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const setBit = (words, index) => {
  const wordIdx = index >>> 5
  const bit = index & 31
  words[wordIdx] |= 1 << bit
}

export const buildDecisionCandidateIndex = ({
  period,
  sequenceWindow,
  asOfShift,
  seriesMap,
  symbolMap,
  universeMap,
  filtersCfg,
  stepALaneId = null,
}) => {
  const byDate = new Map()
  const normalizedStepALaneId = String(stepALaneId ?? "").trim() || null
  const symbolList = Array.from(seriesMap.keys()).sort((a, b) => a.localeCompare(b))
  const symbolIndexMap = new Map(symbolList.map((symbol, idx) => [symbol, idx]))
  const dateSymbolBits = new Map()
  const symbolWordCount = Math.max(1, Math.ceil(symbolList.length / 32))
  const instCache = new Map()
  const minAsOfIdx = Math.max(1, Number(sequenceWindow ?? 40) || 40)

  for (const symbol of symbolList) {
    const series = seriesMap.get(symbol) ?? []
    if (!series.length) continue

    const meta = symbolMap.get(symbol) ?? {
      symbol,
      name: symbol,
      type: "UNKNOWN",
      isListed: true
    }
    let inst = instCache.get(symbol)
    if (!inst) {
      inst = evaluateInstrumentFilter({
        symbol,
        meta,
        cfg: filtersCfg
      })
      instCache.set(symbol, inst)
    }
    if (!inst.pass) continue

    const wordCount = Math.ceil(series.length / 32)
    const structuralBits = new Uint32Array(wordCount)
    const coreBits = new Uint32Array(wordCount)
    const gapBits = new Uint32Array(wordCount)

    for (let decisionIdx = 0; decisionIdx < series.length; decisionIdx += 1) {
      const decisionDateKey = String(series[decisionIdx]?.dateKey ?? "").trim()
      if (!decisionDateKey) continue
      if (!isInRange(decisionDateKey, period)) continue

      const asOfIdx = decisionIdx - asOfShift
      const targetIdx = asOfIdx + 1
      if (asOfIdx < minAsOfIdx || targetIdx < 1 || targetIdx >= series.length) continue
      setBit(structuralBits, decisionIdx)

      const asOfDateKey = String(series[asOfIdx]?.dateKey ?? "").trim()
      if (!asOfDateKey) continue
      const universeRow = universeMap.get(`${symbol}:${asOfDateKey}`)
      const core = evaluateCoreFilters({
        cfg: filtersCfg,
        universeRow
      })
      if (!core.pass) continue
      setBit(coreBits, decisionIdx)

      const prevClose = num(series[asOfIdx - 1]?.close)
      const gap = evaluateGapTradabilityFilter({
        cfg: filtersCfg,
        prevClose
      })
      if (!gap.pass) continue
      setBit(gapBits, decisionIdx)
    }

    for (let wordIdx = 0; wordIdx < wordCount; wordIdx += 1) {
      let word = (structuralBits[wordIdx] & coreBits[wordIdx] & gapBits[wordIdx]) >>> 0
      while (word !== 0) {
        const lsb = word & -word
        const bitIdx = 31 - Math.clz32(lsb)
        const decisionIdx = (wordIdx << 5) + bitIdx
        word = (word ^ lsb) >>> 0
        if (decisionIdx < 0 || decisionIdx >= series.length) continue

        const asOfIdx = decisionIdx - asOfShift
        if (asOfIdx < minAsOfIdx) continue
        const decisionDateKey = String(series[decisionIdx]?.dateKey ?? "").trim()
        const asOfDateKey = String(series[asOfIdx]?.dateKey ?? "").trim()
        const targetIdx = asOfIdx + 1
        if (!decisionDateKey || !asOfDateKey) continue
        if (targetIdx < 1 || targetIdx >= series.length) continue

        const symbolIdx = Number(symbolIndexMap.get(symbol))
        if (Number.isInteger(symbolIdx) && symbolIdx >= 0) {
          let words = dateSymbolBits.get(decisionDateKey)
          if (!words) {
            words = new Uint32Array(symbolWordCount)
            dateSymbolBits.set(decisionDateKey, words)
          }
          const wordIdx = symbolIdx >>> 5
          const mask = 1 << (symbolIdx & 31)
          if ((words[wordIdx] & mask) !== 0) {
            continue
          }
          words[wordIdx] |= mask
        }

        const list = byDate.get(decisionDateKey) ?? []
        list.push({
          symbol,
          decisionIdx,
          asOfIdx,
          targetIdx,
          asOfDateKey,
          stepALaneId: normalizedStepALaneId,
        })
        byDate.set(decisionDateKey, list)
      }
    }
  }

  return byDate
}
