import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH,
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingWindow,
  writeTp12NoStopRollingDerivedSideDailyContract,
} from "../src/lib/tp12_no_stop_rolling_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH))
  const windowId = toText(getFlag(flags, "window-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!windowId || !outPath) {
    throw new Error("build_tp12_no_stop_rolling_window_contract requires --window-id and --out")
  }
  return {
    cwd,
    contractPath,
    windowId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const contract = await loadTp12NoStopRollingResearchContract({
    contractPath: args.contractPath,
    cwd,
  })
  const window = resolveTp12NoStopRollingWindow({
    contract,
    windowId: args.windowId,
  })
  const result = await writeTp12NoStopRollingDerivedSideDailyContract({
    rollingContract: contract,
    windowId: window.windowId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        contractId: result.contract.contractId,
        windowId: window.windowId,
        kind: window.kind,
        trainDateFrom: window.trainDateFrom,
        trainDateTo: window.trainDateTo,
        oosDateFrom: window.oosDateFrom,
        oosDateTo: window.oosDateTo,
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
