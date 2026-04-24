import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { compareDateKey, normalizeDateKey } from "../src/lib/date.mjs"
import { ensureDir, iterateJsonl, pathExists, writeJson, writeJsonl } from "../src/lib/io.mjs"

const toText = (value) => String(value ?? "").trim()

const uniqueSortedStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const parseCsv = (value) => uniqueSortedStrings(String(value ?? "").split(","))

const parseBooleanFlag = (value, fallback = false) => {
  const text = toText(value)
  if (!text) return fallback
  if (["1", "true", "yes", "on"].includes(text.toLowerCase())) return true
  if (["0", "false", "no", "off"].includes(text.toLowerCase())) return false
  throw new Error(`Unsupported boolean flag value: ${value}`)
}

const buildAllowlistKey = ({ symbol, decisionDateKey, stepALaneId = null }) =>
  stepALaneId ? `${decisionDateKey}::${symbol}::${stepALaneId}` : `${decisionDateKey}::${symbol}`

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const inputText = toText(getFlag(flags, "input", null))
  const outText = toText(getFlag(flags, "out", null))
  if (!inputText || !outText) {
    throw new Error("build_tp12_intraday_allowlist_from_pack requires --input and --out")
  }
  const inputPath = path.resolve(cwd, inputText)
  const outPath = path.resolve(cwd, outText)
  const summaryOutPath = path.resolve(
    cwd,
    toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "allowlist_summary.json"))),
  )
  const decisionFrom = normalizeDateKey(getFlag(flags, "decision-from", null))
  const decisionTo = normalizeDateKey(getFlag(flags, "decision-to", null))
  const allowedLanes = parseCsv(getFlag(flags, "allowed-lanes", ""))
  const requireStepALane = parseBooleanFlag(getFlag(flags, "require-stepa-lane", "true"), true)
  return {
    cwd,
    inputPath,
    outPath,
    summaryOutPath,
    decisionFrom,
    decisionTo,
    allowedLanes,
    requireStepALane,
  }
}

const normalizePackRow = (row, { requireStepALane = true } = {}) => {
  const symbol = toText(row?.symbol)
  const decisionDateKey = normalizeDateKey(row?.decisionDateKey ?? row?.dateKey)
  const stepALaneId = toText(row?.stepALaneId) || null
  const sourceType = toText(row?.sourceType) || null
  if (!symbol || !decisionDateKey) {
    throw new Error(
      `Malformed daily_pack allowlist row for symbol=${symbol || "unknown"} decisionDateKey=${row?.decisionDateKey ?? row?.dateKey ?? "null"}`,
    )
  }
  if (requireStepALane && !stepALaneId) {
    throw new Error(`Daily pack allowlist row missing stepALaneId for ${symbol}:${decisionDateKey}`)
  }
  return {
    symbol,
    decisionDateKey,
    stepALaneId,
    sourceType,
  }
}

export const buildTp12IntradayAllowlistFromPack = async ({
  cwd = process.cwd(),
  inputPath,
  outPath,
  summaryOutPath = null,
  decisionFrom = null,
  decisionTo = null,
  allowedLanes = [],
  requireStepALane = true,
} = {}) => {
  const resolved = resolveArgs(
    [
      `--input=${inputPath}`,
      `--out=${outPath}`,
      `--summary-out=${summaryOutPath ?? path.join(path.dirname(outPath), "allowlist_summary.json")}`,
      `--require-stepa-lane=${requireStepALane ? "true" : "false"}`,
      ...(decisionFrom ? [`--decision-from=${decisionFrom}`] : []),
      ...(decisionTo ? [`--decision-to=${decisionTo}`] : []),
      ...(allowedLanes.length > 0 ? [`--allowed-lanes=${allowedLanes.join(",")}`] : []),
    ],
    { cwd },
  )

  if (!pathExists(resolved.inputPath)) {
    throw new Error(`Daily pack input not found: ${resolved.inputPath}`)
  }

  const allowedLaneSet = resolved.allowedLanes.length > 0 ? new Set(resolved.allowedLanes) : null
  const allowlistByKey = new Map()
  const laneCounts = new Map()
  const sourceTypeCounts = new Map()
  let skippedByDecisionRange = 0
  let skippedByLane = 0

  await iterateJsonl(resolved.inputPath, {
    strict: true,
    onRow: async (row) => {
      const normalized = normalizePackRow(row, { requireStepALane: resolved.requireStepALane })
      if (resolved.decisionFrom && normalized.decisionDateKey < resolved.decisionFrom) {
        skippedByDecisionRange += 1
        return
      }
      if (resolved.decisionTo && normalized.decisionDateKey > resolved.decisionTo) {
        skippedByDecisionRange += 1
        return
      }
      if (allowedLaneSet && !allowedLaneSet.has(normalized.stepALaneId ?? "")) {
        skippedByLane += 1
        return
      }
      const allowlistRow = {
        allowlistKey: buildAllowlistKey(normalized),
        symbol: normalized.symbol,
        decisionDateKey: normalized.decisionDateKey,
        stepALaneId: normalized.stepALaneId,
        sourceType: normalized.sourceType,
        sourceInputPath: resolved.inputPath,
      }
      if (!allowlistByKey.has(allowlistRow.allowlistKey)) {
        allowlistByKey.set(allowlistRow.allowlistKey, allowlistRow)
      }
      if (normalized.stepALaneId) {
        laneCounts.set(normalized.stepALaneId, Number(laneCounts.get(normalized.stepALaneId) ?? 0) + 1)
      }
      if (normalized.sourceType) {
        sourceTypeCounts.set(normalized.sourceType, Number(sourceTypeCounts.get(normalized.sourceType) ?? 0) + 1)
      }
    },
  })

  const rows = Array.from(allowlistByKey.values()).sort((left, right) => {
    const dateCmp = compareDateKey(left.decisionDateKey, right.decisionDateKey)
    if (dateCmp !== 0) return dateCmp
    const symbolCmp = left.symbol.localeCompare(right.symbol)
    if (symbolCmp !== 0) return symbolCmp
    return String(left.stepALaneId ?? "").localeCompare(String(right.stepALaneId ?? ""))
  })
  if (rows.length < 1) {
    throw new Error(`No TP12 intraday allowlist rows produced from ${resolved.inputPath}`)
  }

  const summary = {
    status: "ok",
    kind: "tp12_intraday_allowlist_from_pack_v1",
    inputPath: resolved.inputPath,
    outPath: resolved.outPath,
    requireStepALane: resolved.requireStepALane,
    rowCount: rows.length,
    decisionDateFrom: rows[0]?.decisionDateKey ?? null,
    decisionDateTo: rows[rows.length - 1]?.decisionDateKey ?? null,
    laneCounts: Object.fromEntries(Array.from(laneCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    sourceTypeCounts: Object.fromEntries(
      Array.from(sourceTypeCounts.entries()).sort((left, right) => left[0].localeCompare(right[0])),
    ),
    skippedByDecisionRange,
    skippedByLane,
  }

  await ensureDir(path.dirname(resolved.outPath))
  await writeJsonl(resolved.outPath, rows)
  await writeJson(resolved.summaryOutPath, summary)

  return {
    outPath: resolved.outPath,
    summaryOutPath: resolved.summaryOutPath,
    rows,
    summary,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12IntradayAllowlistFromPack({
    cwd: args.cwd,
    inputPath: args.inputPath,
    outPath: args.outPath,
    summaryOutPath: args.summaryOutPath,
    decisionFrom: args.decisionFrom,
    decisionTo: args.decisionTo,
    allowedLanes: args.allowedLanes,
    requireStepALane: args.requireStepALane,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        decisionDateFrom: result.summary.decisionDateFrom,
        decisionDateTo: result.summary.decisionDateTo,
        laneCounts: result.summary.laneCounts,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
