import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import {
  buildTp12IntradayFeaturePackBridge,
  TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND,
} from "../src/lib/tp12_intraday_feature_bridge.mjs"
import { TP12_INTRADAY_FEATURE_DATASET_KIND } from "../src/lib/tp12_intraday_feature_builder.mjs"

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const main = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-tp12-intraday-bridge-"))
  try {
    const featurePackPath = path.join(tempDir, "feature_pack.jsonl")
    const intradayFeaturePath = path.join(tempDir, "intraday_feature_rows.jsonl")
    const outPath = path.join(tempDir, "feature_pack_intraday_d0_close.jsonl")
    const metaPath = path.join(tempDir, "feature_pack_intraday_d0_close.meta.json")

    await writeJsonl(featurePackPath, [
      {
        decisionDateKey: "2026-04-01",
        symbol: "005930",
        featureVec: { "trend.closeOverMa20": 1.25 },
        globalFeatureVec: { "global.volatility40": 0.12 },
        contextualTokens: ["tag:test:fixture"],
      },
      {
        decisionDateKey: "2026-04-02",
        symbol: "000660",
        featureVec: { "trend.closeOverMa20": -0.25 },
        globalFeatureVec: { "global.volatility40": 0.2 },
        contextualTokens: [],
      },
    ])
    await writeJsonl(intradayFeaturePath, [
      {
        kind: TP12_INTRADAY_FEATURE_DATASET_KIND,
        requestId: "req-1",
        symbol: "005930",
        decisionDateKey: "2026-04-01",
        gateId: "d0_close",
        featureCutoffDateKey: "2026-04-01",
        featureCutoffTsKst: "2026-04-01T15:30:00+09:00",
        entryPriceMode: "next_day_open",
        features: {
          d0_first5m_ret: 0.1,
          investor_d0_netbuy: 1000000,
        },
        labels: {
          tp12Hit: 1,
        },
      },
      {
        kind: TP12_INTRADAY_FEATURE_DATASET_KIND,
        requestId: "req-2",
        symbol: "000660",
        decisionDateKey: "2026-04-02",
        gateId: "d0_close",
        featureCutoffDateKey: "2026-04-02",
        featureCutoffTsKst: "2026-04-02T15:30:00+09:00",
        entryPriceMode: "next_day_open",
        features: {
          d0_first5m_ret: -0.2,
          investor_d0_netbuy: -500000,
        },
        labels: {
          tp12Hit: 0,
        },
      },
      {
        kind: TP12_INTRADAY_FEATURE_DATASET_KIND,
        requestId: "req-3",
        symbol: "005930",
        decisionDateKey: "2026-04-01",
        gateId: "d1_0905",
        featureCutoffDateKey: "2026-04-02",
        featureCutoffTsKst: "2026-04-02T09:05:00+09:00",
        entryPriceMode: "cutoff_close",
        features: {
          d1_open_flush_depth: -0.03,
        },
        labels: {
          tp12Hit: 1,
        },
      },
    ])

    const summary = await buildTp12IntradayFeaturePackBridge({
      featurePackPath,
      intradayFeaturePath,
      gateId: "d0_close",
      outPath,
      metaOutPath: metaPath,
    })
    ensure(summary.kind === TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND, "bridge kind mismatch")
    ensure(summary.rowCount === 2, `expected rowCount=2, got ${summary.rowCount}`)

    const rows = await readJsonl(outPath)
    ensure(rows.length === 2, `expected 2 bridged rows, got ${rows.length}`)
    ensure(rows[0]?.featureVec?.["intraday.d0_first5m_ret"] === 0.1, "missing prefixed intraday feature")
    ensure(
      rows[0]?.featureVec?.["intraday.investor_d0_netbuy"] === 1000000,
      "missing prefixed flow intraday feature",
    )
    ensure(rows[0]?.labels === undefined, "bridge must not copy label payload onto feature pack rows")
    ensure(
      Array.isArray(rows[0]?.contextualTokens) && rows[0].contextualTokens.includes("tag:intradayGate:d0_close"),
      "missing intraday gate token",
    )
    ensure(rows[0]?.intradayBridge?.gateId === "d0_close", "missing intradayBridge metadata")

    const meta = await readJson(metaPath, null)
    ensure(meta?.coverage?.status === "full_match", "expected full_match coverage")
    ensure(meta?.rowCount === 2, "expected meta rowCount=2")

    let failedMissingCoverage = false
    try {
      await buildTp12IntradayFeaturePackBridge({
        featurePackPath,
        intradayFeaturePath,
        gateId: "d1_0915",
        outPath: path.join(tempDir, "should_fail.jsonl"),
      })
    } catch (error) {
      failedMissingCoverage = String(error?.message ?? error).includes("No intraday feature rows loaded")
    }
    ensure(failedMissingCoverage, "expected missing gate coverage to fail")
    console.log("ok smoke_tp12_intraday_feature_bridge")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
