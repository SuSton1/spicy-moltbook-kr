import assert from "node:assert/strict"

import { loadTp12SideDailyResearchContract } from "../src/lib/tp12_side_daily_contract.mjs"
import { resolveTp12SideDailyComparisonVariants } from "../src/lib/tp12_side_daily_family_variants.mjs"


const main = async () => {
  const contract = await loadTp12SideDailyResearchContract({
    contractPath: "meta/tp12_side_daily_research_contract.json",
    cwd: process.cwd(),
  })
  const variants = resolveTp12SideDailyComparisonVariants({
    comparisonOrder: contract.comparisonOrder,
    gateId: "d0_close",
  })
  assert.equal(variants.length, 4, `unexpected variant count: ${variants.length}`)
  assert.deepEqual(
    variants.map((variant) => variant.variantId),
    [
      "daily_only_no_stop",
      "daily_plus_investor",
      "daily_plus_program",
      "daily_plus_investor_program",
    ],
  )
  assert.deepEqual(variants[0].datasetIds, [])
  assert.deepEqual(variants[1].datasetIds, ["investor_daily"])
  assert.deepEqual(variants[2].datasetIds, ["program_daily"])
  assert.deepEqual(variants[3].datasetIds, ["investor_daily", "program_daily"])
  console.log("ok smoke_tp12_side_daily_family_variants")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
