import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH,
  loadTp12NoStopRollingResearchContract,
} from "../src/lib/tp12_no_stop_rolling_contract.mjs"
import { buildTp12NoStopRollingSummary } from "../src/lib/tp12_no_stop_rolling_report.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH))
  const manifestPath = toText(getFlag(flags, "manifest-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!manifestPath || !outPath) {
    throw new Error("build_tp12_no_stop_rolling_summary requires --manifest-path and --out")
  }
  return {
    cwd,
    contractPath,
    manifestPath: path.resolve(cwd, manifestPath),
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const contract = await loadTp12NoStopRollingResearchContract({
    contractPath: args.contractPath,
    cwd,
  })
  const result = await buildTp12NoStopRollingSummary({
    rollingContract: contract,
    manifestPath: args.manifestPath,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        reportPath: result.reportPath,
        contractId: result.summary.contractId,
        usableScreenWindows: result.summary?.screen?.primary?.usableWindowCount ?? 0,
        finalConfirmWindowId: result.summary?.finalConfirm?.windowId ?? null,
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
