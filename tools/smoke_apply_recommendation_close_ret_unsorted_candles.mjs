import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJsonl } from "../src/lib/io.mjs"
import { buildRecommendationCloseRetLookupForMatchTargets } from "../src/lib/perfect_prototype_apply_close_ret_lookup.mjs"

const assertApprox = (actual, expected, label) => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`)
  }
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apply-close-ret-unsorted-"))
  const candlePath = path.join(tempRoot, "candle_daily.jsonl")
  await writeJsonl(candlePath, [
    { symbol: "333050", dateKey: "2025-04-14", close: 1887 },
    { symbol: "000001", dateKey: "2025-04-10", close: 1000 },
    { symbol: "333050", dateKey: "2025-04-15", close: 1830 },
    { symbol: "333050", dateKey: "2025-04-10", close: 1600 },
    { symbol: "333050", dateKey: "2025-04-11", close: 1453 },
  ])

  const lookup = await buildRecommendationCloseRetLookupForMatchTargets({
    candlePath,
    targetDatesBySymbol: new Map([
      ["333050", new Set(["2025-04-10", "2025-04-14", "2025-04-15"])],
    ]),
  })

  if (lookup.has("333050::2025-04-10")) {
    throw new Error("unexpected close-ret lookup for first available trading day")
  }

  assertApprox(
    lookup.get("333050::2025-04-14"),
    ((1887 - 1453) / 1453) * 100,
    "unsorted 2025-04-14 lookup",
  )
  assertApprox(
    lookup.get("333050::2025-04-15"),
    ((1830 - 1887) / 1887) * 100,
    "unsorted 2025-04-15 lookup",
  )
}

await main()
