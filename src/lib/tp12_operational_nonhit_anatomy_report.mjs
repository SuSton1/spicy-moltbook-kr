import fs from "node:fs"

import { readJson, writeJson } from "./io.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toText,
} from "./tp12_year2hit_foundation_io.mjs"

const getCandidate = (map, patternId, baseTokenSet = []) => {
  const key = toText(patternId)
  if (!key) throw new Error("support row missing patternId")
  if (!map.has(key)) {
    map.set(key, {
      patternId: key,
      baseTokenSet,
      rows: 0,
      hits: 0,
      misses: 0,
      missReasons: new Map(),
      termRows: new Map(),
      termHits: new Map(),
      termMisses: new Map(),
    })
  }
  const item = map.get(key)
  if (item.baseTokenSet.length < 1 && baseTokenSet.length > 0) item.baseTokenSet = baseTokenSet
  return item
}

const normalizeReasons = (row) => {
  if (Array.isArray(row?.operationalMissReasons)) return row.operationalMissReasons.map(toText).filter(Boolean)
  const single = toText(row?.operationalMissReason)
  return single ? [single] : []
}

const topTerms = (candidate, key, limit) => {
  const source = key === "hit" ? candidate.termHits : candidate.termMisses
  const other = key === "hit" ? candidate.termMisses : candidate.termHits
  return [...source.entries()]
    .map(([term, count]) => ({
      term,
      rows: candidate.termRows.get(term) ?? 0,
      hits: candidate.termHits.get(term) ?? 0,
      misses: candidate.termMisses.get(term) ?? 0,
      contrast: count - (other.get(term) ?? 0),
    }))
    .sort((left, right) => right.contrast - left.contrast || right.rows - left.rows || left.term.localeCompare(right.term))
    .slice(0, limit)
}

export const buildTp12OperationalNonhitAnatomyReport = async ({
  contractPath,
  supportRowsPath,
  outReportPath,
  topTermLimit = 20,
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  if (!toText(supportRowsPath)) throw new Error("supportRowsPath is required")
  if (!toText(outReportPath)) throw new Error("outReportPath is required")
  if (!fs.existsSync(supportRowsPath)) throw new Error(`supportRowsPath not found: ${supportRowsPath}`)
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract file not found: ${contractPath}`)
  const candidates = new Map()
  const globalMissReasons = new Map()
  let rows = 0
  let hits = 0
  let misses = 0
  await iterateJsonlMaybeGzip(supportRowsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`support row missing patternId at ${context.filePath}:${context.lineNumber}`)
      const candidate = getCandidate(candidates, patternId, row?.baseTokenSet ?? [])
      const isHit = row?.operationalHitTarget === true
      rows += 1
      candidate.rows += 1
      if (isHit) {
        hits += 1
        candidate.hits += 1
      } else {
        misses += 1
        candidate.misses += 1
        const reasons = normalizeReasons(row)
        for (const reason of reasons.length > 0 ? reasons : ["unknown"]) {
          incrementMap(candidate.missReasons, reason)
          incrementMap(globalMissReasons, reason)
        }
      }
      for (const term of row?.microTerms ?? []) {
        const key = toText(term)
        if (!key) continue
        incrementMap(candidate.termRows, key)
        if (isHit) incrementMap(candidate.termHits, key)
        else incrementMap(candidate.termMisses, key)
      }
    },
  })
  const candidateReports = [...candidates.values()]
    .map((candidate) => ({
      patternId: candidate.patternId,
      baseTokenSet: candidate.baseTokenSet,
      rows: candidate.rows,
      hits: candidate.hits,
      misses: candidate.misses,
      rowPrecision: candidate.rows > 0 ? candidate.hits / candidate.rows : 0,
      missReasons: mapToSortedObject(candidate.missReasons),
      topHitTerms: topTerms(candidate, "hit", topTermLimit),
      topMissTerms: topTerms(candidate, "miss", topTermLimit),
    }))
    .sort((left, right) => left.misses - right.misses || right.rowPrecision - left.rowPrecision || left.patternId.localeCompare(right.patternId))
  const report = {
    kind: "tp12_operational_nonhit_anatomy_report_v1",
    contractId: contract.contractId,
    patchKey: contract.patchKey,
    supportRowsPath,
    rows,
    hits,
    misses,
    rowPrecision: rows > 0 ? hits / rows : 0,
    candidateCount: candidateReports.length,
    globalMissReasons: mapToSortedObject(globalMissReasons),
    candidates: candidateReports,
  }
  await writeJson(outReportPath, report)
  return { report }
}
