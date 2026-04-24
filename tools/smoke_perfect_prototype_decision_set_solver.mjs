import assert from "node:assert/strict"

import { solvePerfectPrototypeDecisionSet } from "../src/lib/perfect_prototype_decision_set_solver.mjs"

const row = ({ rowKey, sourceId, dateKey, symbol, foldId, windowId }) => ({
  rowKey,
  sourceId,
  dateKey,
  symbol,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget: true,
  foldId,
  windowId,
})

const candidateClauses = [
  {
    ruleId: "CLAUSE_SUPPORT",
    ruleSize: 2,
    haesungSupport: true,
    trainMatchedRows: [
      row({ rowKey: "T1", sourceId: "T1", dateKey: "2025-01-02", symbol: "AAA", foldId: 1, windowId: 1 }),
      row({ rowKey: "T2", sourceId: "T2", dateKey: "2025-02-03", symbol: "BBB", foldId: 1, windowId: 2 }),
      row({ rowKey: "T3", sourceId: "T3", dateKey: "2025-03-04", symbol: "CCC", foldId: 2, windowId: 2 }),
      row({ rowKey: "T4", sourceId: "T4", dateKey: "2025-04-07", symbol: "DDD", foldId: 2, windowId: 3 }),
    ],
    oosMatchedRows: [],
  },
  {
    ruleId: "CLAUSE_OOS_A",
    ruleSize: 2,
    haesungSupport: false,
    trainMatchedRows: [
      row({ rowKey: "T5", sourceId: "T5", dateKey: "2025-05-05", symbol: "EEE", foldId: 3, windowId: 3 }),
      row({ rowKey: "T6", sourceId: "T6", dateKey: "2025-06-05", symbol: "FFF", foldId: 3, windowId: 4 }),
      row({ rowKey: "T7", sourceId: "T7", dateKey: "2025-07-08", symbol: "GGG", foldId: 3, windowId: 4 }),
    ],
    oosMatchedRows: [
      row({ rowKey: "O1", sourceId: "O1", dateKey: "2026-01-05", symbol: "AAA", foldId: 0, windowId: 0 }),
      row({ rowKey: "O2", sourceId: "O2", dateKey: "2026-01-12", symbol: "BBB", foldId: 0, windowId: 0 }),
    ],
  },
  {
    ruleId: "CLAUSE_OOS_B",
    ruleSize: 2,
    haesungSupport: false,
    trainMatchedRows: [
      row({ rowKey: "T8", sourceId: "T8", dateKey: "2025-08-05", symbol: "HHH", foldId: 4, windowId: 5 }),
      row({ rowKey: "T9", sourceId: "T9", dateKey: "2025-09-09", symbol: "III", foldId: 4, windowId: 5 }),
      row({ rowKey: "T10", sourceId: "T10", dateKey: "2025-10-10", symbol: "JJJ", foldId: 4, windowId: 6 }),
    ],
    oosMatchedRows: [
      row({ rowKey: "O3", sourceId: "O3", dateKey: "2026-01-21", symbol: "CCC", foldId: 0, windowId: 0 }),
    ],
  },
]

const solved = solvePerfectPrototypeDecisionSet({
  candidateClauses,
  maxClauses: 3,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  maxCrossfitNegativeWindows: 0,
  minCrossfitPositiveWindows: 2,
  minOpenOosPrecision: 1,
  minOpenOosMatchCount: 3,
  minOpenOosUniqueMatchedDates: 3,
})

assert.equal(solved.ok, true)
assert.deepEqual(solved.ruleIds, ["CLAUSE_SUPPORT", "CLAUSE_OOS_A", "CLAUSE_OOS_B"])
assert.equal(solved.haesungSupport, true)
assert.equal(solved.train.uniqueDateCount, 10)
assert.equal(solved.oos.precision, 1)
assert.equal(solved.oos.uniqueDateCount, 3)

console.log("ok")
