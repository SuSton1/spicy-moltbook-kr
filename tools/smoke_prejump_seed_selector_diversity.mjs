import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { selectSeedEntries } from "../src/lib/perfect_prototype_miner.mjs"
import { resolvePerfectPrototypeDuckdbCli, runPerfectPrototypeDuckdbSql, sqlQuote } from "../src/lib/perfect_prototype_duckdb.mjs"
import { streamSelectPerfectPrototypeSeedEntries } from "../src/lib/perfect_prototype_seed_selector.mjs"

const buildSeedEntry = ({ token, positiveMatchCount, negativeMatchCount }) => ({
  token,
  positiveMatchCount,
  negativeMatchCount,
  precision:
    positiveMatchCount + negativeMatchCount > 0
      ? positiveMatchCount / (positiveMatchCount + negativeMatchCount)
      : 0,
  separationRatio: positiveMatchCount / (negativeMatchCount + 1),
  separationLift: positiveMatchCount - negativeMatchCount,
})

const fixtureEntries = [
  buildSeedEntry({ token: "c1", positiveMatchCount: 60, negativeMatchCount: 40 }),
  buildSeedEntry({ token: "l1", positiveMatchCount: 30, negativeMatchCount: 15 }),
  buildSeedEntry({ token: "p1", positiveMatchCount: 7, negativeMatchCount: 0 }),
  buildSeedEntry({ token: "p2", positiveMatchCount: 6, negativeMatchCount: 0 }),
  buildSeedEntry({ token: "p3", positiveMatchCount: 5, negativeMatchCount: 0 }),
  buildSeedEntry({ token: "p4", positiveMatchCount: 4, negativeMatchCount: 0 }),
  buildSeedEntry({ token: "r1", positiveMatchCount: 16, negativeMatchCount: 1 }),
]

const main = async () => {
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "smoke-prejump-seed-selector-"))
  try {
    const tokenStatsPath = path.join(rootDir, "token_stats.parquet")
    const valuesSql = fixtureEntries
      .slice()
      .sort((left, right) => String(left.token).localeCompare(String(right.token)))
      .map(
        (entry) =>
          `(${sqlQuote(entry.token)}, ${entry.positiveMatchCount}, ${entry.negativeMatchCount}, ${entry.precision}, ${entry.separationRatio}, ${entry.separationLift})`,
      )
      .join(",\n")
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb,
      sql: `
COPY (
  SELECT *
  FROM (
    VALUES
      ${valuesSql}
  ) AS t(token, positiveMatchCount, negativeMatchCount, precision, separationRatio, separationLift)
  ORDER BY token
) TO ${sqlQuote(tokenStatsPath)} (FORMAT PARQUET, COMPRESSION ZSTD);
`,
    })

    const streamed = await streamSelectPerfectPrototypeSeedEntries({
      cwd,
      duckdb,
      tokenStatsPath,
      minHitCount: 1,
      maxSeedTokens: 4,
      expectedTokenCount: fixtureEntries.length,
    })
    const legacy = selectSeedEntries(fixtureEntries, 4)
    const streamedTokens = streamed.seedEntries.map((entry) => entry.token)
    const legacyTokens = legacy.map((entry) => entry.token)

    assert.deepEqual(
      streamedTokens,
      legacyTokens,
      "streaming indexed selector should match the legacy diversified seed contract",
    )
    assert.deepEqual(
      streamedTokens,
      ["p1", "r1", "c1", "l1"],
      "fixture should exercise diversified rank coverage rather than pure precision ordering",
    )
    console.log("seed selector diversity smoke ok")
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
