#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { mineTp12Year2hitCandidates } from "../src/lib/tp12_year2hit_candidate_miner.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-candidate-miner-"))
try {
  const tokenizedEventsPath = path.join(tmp, "tokenized.jsonl")
  const outCatalogPath = path.join(tmp, "candidate_catalog.jsonl")
  const rows = []
  for (let year = 2016; year <= 2024; year += 1) {
    for (const day of ["03", "17"]) {
      rows.push({
        eventId: `hit_${year}_${day}`,
        symbol: `H${year}${day}`,
        decisionDateKey: `${year}-01-${day}`,
        hitTarget: true,
        tokens: ["family:alpha", "family:beta", `diagnostic:year_${year}`],
      })
    }
    rows.push({
      eventId: `neg_${year}`,
      symbol: `N${year}`,
      decisionDateKey: `${year}-02-03`,
      hitTarget: false,
      tokens: ["family:alpha"],
    })
  }
  await writeJsonl(tokenizedEventsPath, rows)
  const { manifest } = await mineTp12Year2hitCandidates({
    tokenizedEventsPath,
    outCatalogPath,
    trainDateFrom: "2016-01-01",
    trainDateTo: "2024-12-31",
    coreYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
    minHitsPerYear: 2,
    maxPatternSize: 2,
    minSeedHitRows: 18,
    minSeedMatchRows: 18,
    minSeedPrecision: 0,
    minCandidatePrecision: 0.5,
  })
  assert.equal(manifest.status, "passed")
  assert.ok(manifest.survivorCount >= 1)
  const catalogRows = (await fs.readFile(outCatalogPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.ok(catalogRows.some((row) => row.patternKind === "pair_token" && row.tokenSet.join("|") === "family:alpha|family:beta"))
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_candidate_miner")
