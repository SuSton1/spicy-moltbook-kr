import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_NO_GAP_ADDON_CONTRACT_PATH,
  loadTp12NoGapAddonContract,
  writeTp12NoGapAddonCandidateRollingContract,
} from "../src/lib/tp12_no_gap_addon_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TP12_NO_GAP_ADDON_CONTRACT_PATH))
  const candidateId = toText(getFlag(flags, "candidate-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!candidateId || !outPath) {
    throw new Error("build_tp12_no_gap_addon_candidate_contract requires --candidate-id and --out")
  }
  return {
    cwd,
    contractPath,
    candidateId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const addonContract = await loadTp12NoGapAddonContract({
    contractPath: args.contractPath,
    cwd,
  })
  const result = await writeTp12NoGapAddonCandidateRollingContract({
    addonContract,
    candidateId: args.candidateId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        contractId: result.contract.contractId,
        scopeId: result.contract.scopeId,
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
