import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { normalizeDateKey } from "../src/lib/date.mjs"
import { buildTp12SideDailyControlArtifact } from "../src/lib/tp12_side_daily_control_builder.mjs"
import {
  DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH,
  resolveTp12SideDailyControlArgsFromContract,
} from "../src/lib/tp12_side_daily_contract.mjs"


const toText = (value) => String(value ?? "").trim()

const parseCsv = (value) =>
  Array.from(new Set(String(value ?? "").split(",").map((token) => token.trim()).filter(Boolean)))

const resolveArgs = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const manifestPathRaw = toText(getFlag(flags, "manifest-path", ""))
  const featurePackPathRaw = toText(getFlag(flags, "feature-pack-path", ""))
  const outPathRaw = toText(getFlag(flags, "out", ""))
  if (!manifestPathRaw || !featurePackPathRaw || !outPathRaw) {
    throw new Error("build_tp12_side_daily_control requires --manifest-path --feature-pack-path --out")
  }
  const outPath = path.resolve(cwd, outPathRaw)
  const directDecisionFrom = normalizeDateKey(getFlag(flags, "decision-from", null))
  const directDecisionTo = normalizeDateKey(getFlag(flags, "decision-to", null))
  const directTrainDateFrom = normalizeDateKey(getFlag(flags, "train-date-from", null))
  const directTrainDateTo = normalizeDateKey(getFlag(flags, "train-date-to", null))
  const directOosDateFrom = normalizeDateKey(getFlag(flags, "oos-date-from", null))
  const directOosDateTo = normalizeDateKey(getFlag(flags, "oos-date-to", null))
  const directStepALaneSet = parseCsv(getFlag(flags, "stepa-lane-set", ""))
  const directTargetLabelIds = parseCsv(getFlag(flags, "target-label-ids", ""))
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH))
  return resolveTp12SideDailyControlArgsFromContract({
    contractPath,
    cwd,
    decisionFrom: directDecisionFrom,
    decisionTo: directDecisionTo,
    trainDateFrom: directTrainDateFrom,
    trainDateTo: directTrainDateTo,
    oosDateFrom: directOosDateFrom,
    oosDateTo: directOosDateTo,
    stepALaneSet: directStepALaneSet,
    targetLabelIds: directTargetLabelIds,
    allowlistPolicy: toText(getFlag(flags, "allowlist-policy", "")),
    commonSupportPolicy: toText(getFlag(flags, "common-support-policy", "")),
  }).then((resolvedContractArgs) => ({
    manifestPath: path.resolve(cwd, manifestPathRaw),
    featurePackPath: path.resolve(cwd, featurePackPathRaw),
    candlePath: path.resolve(cwd, toText(getFlag(flags, "candle-path", "data/candle_daily.jsonl"))),
    outPath,
    labelOutPath: path.resolve(
      cwd,
      toText(getFlag(flags, "label-out", path.join(path.dirname(outPath), "no_stop_label_rows.jsonl"))),
    ),
    summaryOutPath: path.resolve(
      cwd,
      toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "control_summary.json"))),
    ),
    researchContract: resolvedContractArgs.contract,
    decisionFrom: resolvedContractArgs.decisionFrom,
    decisionTo: resolvedContractArgs.decisionTo,
    trainDateFrom: resolvedContractArgs.trainDateFrom,
    trainDateTo: resolvedContractArgs.trainDateTo,
    oosDateFrom: resolvedContractArgs.oosDateFrom,
    oosDateTo: resolvedContractArgs.oosDateTo,
    stepALaneSet: resolvedContractArgs.stepALaneSet,
    targetLabelIds: resolvedContractArgs.targetLabelIds,
    allowlistPolicy: resolvedContractArgs.allowlistPolicy,
    commonSupportPolicy: resolvedContractArgs.commonSupportPolicy,
  }))
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = await resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyControlArtifact(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        labelOutPath: result.labelOutPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        trainRowCount: result.summary.trainRowCount,
        oosRowCount: result.summary.oosRowCount,
        contractId: result.summary?.researchContract?.contractId ?? null,
        targetLabelIds: result.summary.targetLabelIds,
        stepALaneSet: result.summary.stepALaneSet,
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
