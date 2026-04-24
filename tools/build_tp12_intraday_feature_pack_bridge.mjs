import path from "node:path"

import { buildTp12IntradayFeaturePackBridge } from "../src/lib/tp12_intraday_feature_bridge.mjs"

const toText = (value) => String(value ?? "").trim()

const parseFlags = (argv) => {
  const flags = new Map()
  for (const token of argv) {
    if (!token.startsWith("--")) continue
    const raw = token.slice(2)
    const eqIndex = raw.indexOf("=")
    if (eqIndex < 0) {
      flags.set(raw, true)
      continue
    }
    flags.set(raw.slice(0, eqIndex), raw.slice(eqIndex + 1))
  }
  return flags
}

const getFlag = (flags, key, defaultValue = "") => (flags.has(key) ? flags.get(key) : defaultValue)

const main = async () => {
  const flags = parseFlags(process.argv.slice(2))
  const featurePackRaw = toText(getFlag(flags, "feature-pack-path"))
  const intradayFeatureRaw = toText(getFlag(flags, "intraday-feature-path"))
  const gateId = toText(getFlag(flags, "gate-id"))
  const outRaw = toText(getFlag(flags, "out"))
  if (!featurePackRaw || !intradayFeatureRaw || !gateId || !outRaw) {
    throw new Error(
      "build_tp12_intraday_feature_pack_bridge requires --feature-pack-path --intraday-feature-path --gate-id --out",
    )
  }
  const cwd = process.cwd()
  const summary = await buildTp12IntradayFeaturePackBridge({
    featurePackPath: path.resolve(cwd, featurePackRaw),
    intradayFeaturePath: path.resolve(cwd, intradayFeatureRaw),
    gateId,
    outPath: path.resolve(cwd, outRaw),
    metaOutPath: path.resolve(cwd, toText(getFlag(flags, "meta-out", `${outRaw}.meta.json`))),
    decisionFrom: toText(getFlag(flags, "decision-from")),
    decisionTo: toText(getFlag(flags, "decision-to")),
  })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
