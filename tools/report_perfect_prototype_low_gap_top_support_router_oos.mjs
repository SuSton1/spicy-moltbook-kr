#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import {
  applyPerfectPrototypeSupportPrototypeRouter,
  summarizePerfectPrototypeSupportPrototypeRouterSelections,
} from "../src/lib/perfect_prototype_support_prototype_router_apply.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/report_perfect_prototype_low_gap_top_support_router_oos.mjs \\
    --artifact=<support_prototype_router_artifact.json> \\
    --input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out=<summary.json>`)
}

const parseArgs = (argv) => {
  const args = {}
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    }
    if (!arg.startsWith("--")) continue
    const [key, ...rest] = arg.slice(2).split("=")
    const value = rest.join("=")
    if (key === "artifact") args.artifact = value
    else if (key === "input") args.input = value
    else if (key === "support-cases-file") args.supportCasesFile = value
    else if (key === "out") args.out = value
  }
  if (!args.artifact || !args.input || !args.supportCasesFile || !args.out) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

const loadJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const artifact = JSON.parse(await fs.readFile(args.artifact, "utf8"))
  const rows = await loadJsonl(args.input)
  const supportPayload = JSON.parse(await fs.readFile(args.supportCasesFile, "utf8"))
  const supportCases = supportPayload?.supportCases ?? supportPayload
  const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
    familyId: artifact.familyId ?? "low_gap_top_continuation",
    trainRows: rows,
    oosRows: [],
    supportCases,
    surfaceName: artifact.surfaceName,
  })
  const summary = summarizePerfectPrototypeSupportPrototypeRouterSelections({
    evaluations: applyPerfectPrototypeSupportPrototypeRouter({
      artifact,
      rows: cohort.trainRows,
    }),
    supportCaseIds: artifact.supportCaseIds ?? [],
  })
  await writeJson(args.out, summary)
}

await main()

