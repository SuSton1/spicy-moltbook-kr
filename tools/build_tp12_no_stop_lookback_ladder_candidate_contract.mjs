import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  loadTp12NoStopLookbackLadderContract,
  resolveTp12NoStopLookbackCandidate,
  writeTp12NoStopLookbackCandidateRollingContract,
} from "../src/lib/tp12_no_stop_lookback_ladder_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(
    getFlag(flags, "contract-path", DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH),
  )
  const candidateId = toText(getFlag(flags, "candidate-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!candidateId || !outPath) {
    throw new Error("build_tp12_no_stop_lookback_ladder_candidate_contract requires --candidate-id and --out")
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
  const ladderContract = await loadTp12NoStopLookbackLadderContract({
    contractPath: args.contractPath,
    cwd,
  })
  const candidate = resolveTp12NoStopLookbackCandidate({
    ladderContract,
    candidateId: args.candidateId,
  })
  const result = await writeTp12NoStopLookbackCandidateRollingContract({
    ladderContract,
    candidateId: candidate.candidateId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        candidateId: candidate.candidateId,
        candidateStage: candidate.stage,
        lookbackTradingDays: candidate.lookbackTradingDays,
        discoveryUniverseId: candidate.discoveryUniverseId,
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
