import { createPerfectPrototypeMatchAccumulator } from "../src/lib/perfect_prototype_dedupe.mjs"

const main = async () => {
  const rules = [
    {
      ruleId: "PP_ALPHA",
      tokens: ["feat.alpha"],
      trainHitCount: 3,
      precision: 1,
      maxGapTradingDays: 0,
      selectionOpenOosPrecision: 0.8,
      selectionOpenOosHitCount: 4,
      selectionOpenOosUniqueMatchedDates: 4,
      selectionOpenOosUniqueMatchedSymbols: 4,
    },
    {
      ruleId: "PP_BETA",
      tokens: ["feat.beta"],
      trainHitCount: 2,
      precision: 1,
      maxGapTradingDays: 0,
      selectionOpenOosPrecision: 1,
      selectionOpenOosHitCount: 2,
      selectionOpenOosUniqueMatchedDates: 2,
      selectionOpenOosUniqueMatchedSymbols: 2,
    },
  ]

  const accumulator = createPerfectPrototypeMatchAccumulator({ rules })
  accumulator.consume({
    dateKey: "2026-03-18",
    symbol: "123010",
    matchedRuleIds: ["PP_ALPHA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_ALPHA",
  })
  accumulator.consume({
    dateKey: "2026-03-18",
    symbol: "123010",
    matchedRuleIds: ["PP_BETA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_BETA",
  })
  const { dedupedMatches, overlapRows } = accumulator.finalize()
  if (dedupedMatches.length !== 1) {
    throw new Error(`expected one deduped row, got ${dedupedMatches.length}`)
  }
  const row = dedupedMatches[0]
  if (row.primaryRuleId !== "PP_BETA") {
    throw new Error(`expected selection-aware primaryRuleId=PP_BETA, got ${row.primaryRuleId ?? "null"}`)
  }
  if (!Array.isArray(row.supportingRuleIds) || row.supportingRuleIds.length !== 1 || row.supportingRuleIds[0] !== "PP_ALPHA") {
    throw new Error("expected supportingRuleIds to retain the non-primary rule")
  }
  if (row.matchedRuleCount !== 2 || row.consensusScore !== 2) {
    throw new Error("expected merged matchedRuleCount/consensusScore of 2")
  }
  if (row.bestOpenOosPrecision !== 1 || row.bestOpenOosHitCount !== 2) {
    throw new Error("expected best open-OOS metrics from the selected primary rule")
  }
  if (overlapRows.length !== 1 || overlapRows[0]?.primaryRuleId !== "PP_BETA") {
    throw new Error("expected overlap row to record the recomputed primary rule")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
