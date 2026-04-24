import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_PATH,
  loadTp12NoStopScopeExpansionContract,
  resolveTp12NoStopScopeExpansionCandidate,
  writeTp12NoStopScopeExpansionCandidateRollingContract,
} from "../src/lib/tp12_no_stop_scope_expansion_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(
    getFlag(flags, "contract-path", DEFAULT_TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_PATH),
  )
  const scopeId = toText(getFlag(flags, "scope-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!scopeId || !outPath) {
    throw new Error("build_tp12_no_stop_scope_expansion_candidate_contract requires --scope-id and --out")
  }
  return {
    cwd,
    contractPath,
    scopeId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const scopeExpansionContract = await loadTp12NoStopScopeExpansionContract({
    contractPath: args.contractPath,
    cwd,
  })
  const candidate = resolveTp12NoStopScopeExpansionCandidate({
    scopeExpansionContract,
    scopeId: args.scopeId,
  })
  const result = await writeTp12NoStopScopeExpansionCandidateRollingContract({
    scopeExpansionContract,
    scopeId: candidate.scopeId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        scopeId: candidate.scopeId,
        scopeStage: candidate.stage,
        baseCandidateId: scopeExpansionContract.baseCandidateId,
        baseLookbackTradingDays: scopeExpansionContract.baseRollingContract?.inputContract?.requestedLookbackTradingDays ?? null,
        discoveryUniverseId: scopeExpansionContract.baseRollingContract?.inputContract?.discoveryUniverseId ?? null,
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
