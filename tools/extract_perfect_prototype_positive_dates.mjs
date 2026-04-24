#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { readJsonl } from "../src/lib/io.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/extract_perfect_prototype_positive_dates.mjs \\
    --input=<daily_pack.jsonl> \\
    --out=<date_keys.json>`)
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
    if (key === "input") args.input = value
    else if (key === "out") args.out = value
    else throw new Error(`Unknown arg: --${key}`)
  }
  if (!args.input || !args.out) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const rows = await readJsonl(args.input, { strict: true })
  const dateKeys = Array.from(
    new Set(
      rows
        .filter((row) => row?.outcomeHitTarget === true)
        .map((row) => String(row?.dateKey ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
  await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
  await fs.writeFile(
    args.out,
    `${JSON.stringify({ dateKeys, count: dateKeys.length }, null, 2)}\n`,
    "utf8",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
