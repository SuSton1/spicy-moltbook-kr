import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_PATH,
  loadTp12Year2x8BankDiscoveryContract,
} from "../src/lib/tp12_year2x8_contract.mjs"
import {
  resolveTp12Year2x8BankDiscoveryCell,
  writeTp12Year2x8BankDiscoveryRollingContract,
} from "../src/lib/tp12_bank_grid_contracts.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(
    getFlag(flags, "contract-path", DEFAULT_TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_PATH),
  )
  const scopeId = toText(getFlag(flags, "scope-id", ""))
  const candidateId = toText(getFlag(flags, "candidate-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!scopeId || !candidateId || !outPath) {
    throw new Error(
      "build_tp12_year2x8_bank_discovery_candidate_contract requires --scope-id, --candidate-id, and --out",
    )
  }
  return {
    cwd,
    contractPath,
    scopeId,
    candidateId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const year2x8Contract = await loadTp12Year2x8BankDiscoveryContract({
    contractPath: args.contractPath,
    cwd,
  })
  const cell = resolveTp12Year2x8BankDiscoveryCell({
    year2x8Contract,
    scopeId: args.scopeId,
    candidateId: args.candidateId,
  })
  const result = await writeTp12Year2x8BankDiscoveryRollingContract({
    year2x8Contract,
    scopeId: cell.scopeId,
    candidateId: cell.candidateId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        cellId: cell.cellId,
        scopeId: cell.scopeId,
        candidateId: cell.candidateId,
        lookbackTradingDays: cell.lookbackTradingDays,
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
