#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { mineTp12Year2hitCandidates } from "../src/lib/tp12_year2hit_candidate_miner.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-operational-seed-probe-"))
try {
  const tokenizedEventsPath = path.join(tmp, "tokenized.jsonl")
  const outCatalogPath = path.join(tmp, "candidate_catalog.jsonl")
  const outManifestPath = path.join(tmp, "candidate_manifest.json")
  const rows = []
  for (let year = 2016; year <= 2024; year += 1) {
    for (const day of ["03", "17"]) {
      rows.push({
        eventId: `hit_${year}_${day}`,
        symbol: `H${year}${day}`,
        decisionDateKey: `${year}-01-${day}`,
        hitTarget: true,
        entryExecutable: true,
        operationalHitTarget: true,
        tokens: ["seed:alpha", "seed:beta", "seed:gamma"],
      })
    }
    rows.push({
      eventId: `miss_alpha_${year}`,
      symbol: `MA${year}`,
      decisionDateKey: `${year}-02-03`,
      hitTarget: false,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["seed:alpha"],
    })
    rows.push({
      eventId: `miss_beta_${year}`,
      symbol: `MB${year}`,
      decisionDateKey: `${year}-02-17`,
      hitTarget: false,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["seed:beta"],
    })
    rows.push({
      eventId: `miss_gamma_${year}`,
      symbol: `MG${year}`,
      decisionDateKey: `${year}-03-03`,
      hitTarget: false,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["seed:gamma"],
    })
    rows.push({
      eventId: `chart_only_${year}`,
      symbol: `CO${year}`,
      decisionDateKey: `${year}-03-17`,
      hitTarget: true,
      entryExecutable: false,
      operationalHitTarget: false,
      tokens: ["seed:chart_only"],
    })
  }
  await writeJsonl(tokenizedEventsPath, rows)
  const { manifest } = await mineTp12Year2hitCandidates({
    tokenizedEventsPath,
    outCatalogPath,
    outManifestPath,
    trainDateFrom: "2016-01-01",
    trainDateTo: "2024-12-31",
    coreYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
    minHitsPerYear: 2,
    maxPatternSize: 2,
    minSeedHitRows: 18,
    minSeedMatchRows: 18,
    minSeedPrecision: 0,
    hitField: "operationalHitTarget",
    requiredTrainPrecision: 1,
    minCandidatePrecision: 1,
    minCandidateDatePrecision: 1,
    minCandidateHitRows: 18,
    minCandidateHitDates: 18,
    maxFalsePositiveRows: 0,
    maxNonExecutableRows: 0,
    maxTokensPerPositiveEvent: 16,
    earlyDedupe: {
      enabled: true,
      exactSupport: true,
      nearSupportJaccard: 0.98,
      containment: 0.98,
      minContainmentSizeRatio: 0.9,
    },
    failOnZeroOperational100Seed: true,
    lockedFutureFrom: "2025-01-02",
  })
  assert.equal(manifest.status, "passed")
  assert.ok(manifest.survivorCount >= 1)
  assert.ok(manifest.earlyDedupedCandidateCount >= 1)
  const catalogRows = (await fs.readFile(outCatalogPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  const perfectPair = catalogRows.find((row) => row.patternKind === "pair_token" && row.tokenSet.join("|") === "seed:alpha|seed:beta")
  assert.ok(perfectPair)
  assert.equal(perfectPair.falsePositiveRows, 0)
  assert.equal(perfectPair.nonExecutableRows, 0)
  assert.equal(perfectPair.rowPrecision, 1)
  assert.equal(catalogRows.some((row) => row.tokenSet.includes("seed:chart_only")), false)

  const futurePath = path.join(tmp, "future_tokenized.jsonl")
  await writeJsonl(futurePath, [
    ...rows,
    {
      eventId: "future",
      symbol: "FUT",
      decisionDateKey: "2025-01-02",
      hitTarget: true,
      entryExecutable: true,
      operationalHitTarget: true,
      tokens: ["seed:alpha", "seed:beta"],
    },
  ])
  await assert.rejects(
    mineTp12Year2hitCandidates({
      tokenizedEventsPath: futurePath,
      outCatalogPath: path.join(tmp, "future_catalog.jsonl"),
      trainDateFrom: "2016-01-01",
      trainDateTo: "2024-12-31",
      hitField: "operationalHitTarget",
      lockedFutureFrom: "2025-01-02",
    }),
    /forbidden future tuning row/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_operational_seed_existence_probe")
