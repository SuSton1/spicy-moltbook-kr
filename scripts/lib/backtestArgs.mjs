import { normalizeDateKey } from "../ai-date-range.lib.mjs"
import { getArgValue, hasFlag, parseNumberArg } from "./cliArgs.mjs"

export const parseBacktestArgs = (argv = process.argv.slice(2)) => {
  const args = Array.isArray(argv) ? argv : []
  const fromDateKey = normalizeDateKey(
    getArgValue(args, "--fromDateKey") ?? getArgValue(args, "--from"),
  )
  const toDateKey = normalizeDateKey(
    getArgValue(args, "--toDateKey") ?? getArgValue(args, "--to"),
  )
  const trackRaw = String(getArgValue(args, "--track") ?? "all")
    .trim()
    .toUpperCase()
  const windowRaw = String(getArgValue(args, "--window") ?? "")
    .trim()
    .toLowerCase()
  const asOfInput = getArgValue(args, "--asOf")
  const evalWeeksRaw = parseNumberArg(getArgValue(args, "--evalWeeks"))
  const targetPctRaw = parseNumberArg(getArgValue(args, "--targetPct"))
  const highWeekPctRaw = parseNumberArg(getArgValue(args, "--highWeekPct"))
  const minOtherWeekPctRaw = parseNumberArg(
    getArgValue(args, "--minOtherWeekPct"),
  )
  const minTradesRaw = parseNumberArg(getArgValue(args, "--minCompletedTrades"))
  const entryFeeBpsRaw = parseNumberArg(getArgValue(args, "--entryFeeBps"))
  const exitFeeBpsRaw = parseNumberArg(getArgValue(args, "--exitFeeBps"))
  const taxBpsRaw = parseNumberArg(getArgValue(args, "--taxBps"))
  const slippageBpsRaw = parseNumberArg(getArgValue(args, "--slippageBps"))
  const roleRaw = String(getArgValue(args, "--role") ?? "")
    .trim()
    .toUpperCase()
  const dryRun = hasFlag(args, "--dryRun")
  const fixturePath =
    getArgValue(args, "--fixture") ??
    (hasFlag(args, "--fixture") ? "default" : null)

  return {
    fromDateKey,
    toDateKey,
    trackRaw,
    windowRaw,
    asOfInput,
    evalWeeks: evalWeeksRaw ?? 16,
    targetPct: targetPctRaw ?? null,
    highWeekPct: highWeekPctRaw ?? 10,
    minOtherWeekPct: minOtherWeekPctRaw ?? 0.01,
    minCompletedTrades: minTradesRaw ?? 1,
    entryFeeBps: entryFeeBpsRaw ?? null,
    exitFeeBps: exitFeeBpsRaw ?? null,
    taxBps: taxBpsRaw ?? null,
    slippageBps: slippageBpsRaw ?? null,
    roleRaw,
    dryRun,
    fixturePath,
  }
}
