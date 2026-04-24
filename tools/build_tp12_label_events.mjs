#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12LabelEvents } from "../src/lib/tp12_label_event_builder.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const candlePath = toText(getFlag(flags, "candle-path", ""))
  const outEventsPath = toText(getFlag(flags, "out-events", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", ""))
  if (!candlePath || !outEventsPath) {
    throw new Error("build_tp12_label_events requires --candle-path and --out-events")
  }
  const summary = await buildTp12LabelEvents({
    candlePath: path.resolve(cwd, candlePath),
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outEventsPath: path.resolve(cwd, outEventsPath),
    outSummaryPath: outSummaryPath ? path.resolve(cwd, outSummaryPath) : null,
    labelConfigId: toText(getFlag(flags, "label-config-id", "")) || undefined,
    entryRule: toText(getFlag(flags, "entry-rule", "")) || undefined,
    targetPct: optionalNumber(getFlag(flags, "target-pct", "")),
    holdDays: optionalNumber(getFlag(flags, "hold-days", "")),
    stopLossPct: optionalNumber(getFlag(flags, "stop-loss-pct", "")),
    stopPolicy: toText(getFlag(flags, "stop-policy", "")) || undefined,
    sameBarPolicy: toText(getFlag(flags, "same-bar-policy", "")) || undefined,
    labelHorizonDateTo: toText(getFlag(flags, "label-horizon-to", "")) || undefined,
    horizonBoundaryPolicy: toText(getFlag(flags, "horizon-boundary-policy", "")) || undefined,
    terminalForwardPolicy: toText(getFlag(flags, "terminal-forward-policy", "")) || undefined,
    decisionDateFrom: toText(getFlag(flags, "decision-from", "")) || undefined,
    decisionDateTo: toText(getFlag(flags, "decision-to", "")) || undefined,
    failOnInvalidLabels:
      getFlag(flags, "fail-on-invalid-labels", undefined) === undefined
        ? undefined
        : toBool(getFlag(flags, "fail-on-invalid-labels", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outEventsPath: path.resolve(cwd, outEventsPath),
        outSummaryPath: outSummaryPath ? path.resolve(cwd, outSummaryPath) : null,
        labelConfigId: summary.labelConfig.labelConfigId,
        decisionRowCount: summary.decisionRowCount,
        candidateDecisionRowCount: summary.candidateDecisionRowCount,
        horizonSkippedRowCount: summary.horizonSkippedRowCount,
        terminalForwardSkippedRowCount: summary.terminalForwardSkippedRowCount,
        validLabelCount: summary.validLabelCount,
        hitRowCount: summary.hitRowCount,
        rowHitRate: summary.rowHitRate,
        invalidLabelCount: summary.invalidLabelCount,
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
