import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  const lines = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row))
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
}

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "low-gap-top-generalized-runtime-"))

  const wrapperPath = path.resolve("tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_generalized.sh")
  const wrapperRun = spawnSync(
    "bash",
    [wrapperPath, "--support-cases-file=/tmp/forbidden-support-case.json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
  assert.notEqual(wrapperRun.status, 0, "generalized wrapper should reject support-case args")
  assert.match(
    `${wrapperRun.stderr}\n${wrapperRun.stdout}`,
    /support-case-free/i,
    "generalized wrapper should explain support-case rejection",
  )

  const inputPath = path.join(tmpDir, "daily_pack.jsonl")
  const leaderboardPath = path.join(tmpDir, "selection_leaderboard.json")
  const matchesPath = path.join(tmpDir, "matches.jsonl")
  const outPath = path.join(tmpDir, "differential.json")

  await writeJsonl(inputPath, [
    {
      dateKey: "2025-01-02",
      symbol: "000001",
      contextualTokens: ["tag:test:shared", "tag:test:tp_only"],
      categoricalTokens: ["tag:lowGapTop.retentionRegime:STICKY"],
    },
    {
      dateKey: "2025-01-03",
      symbol: "000002",
      contextualTokens: ["tag:test:shared", "tag:test:fp_only"],
      categoricalTokens: ["tag:lowGapTop.fpRisk:HIGH"],
    },
  ])
  await writeJson(leaderboardPath, [
    {
      ruleId: "PP_TP",
      familyId: "low_gap_top_continuation",
      openOosMatchCount: 2,
      openOosNegativeCount: 0,
    },
    {
      ruleId: "PP_FP",
      familyId: "low_gap_top_continuation",
      openOosMatchCount: 2,
      openOosNegativeCount: 1,
    },
  ])
  await writeJsonl(matchesPath, [
    {
      dateKey: "2025-01-02",
      symbol: "000001",
      outcomeHitTarget: true,
      matchedRuleIds: ["PP_TP"],
    },
    {
      dateKey: "2025-01-03",
      symbol: "000002",
      outcomeHitTarget: false,
      matchedRuleIds: ["PP_FP"],
    },
  ])

  const differentialRun = spawnSync(
    "node",
    [
      "tools/report_low_gap_top_cluster_differentials.mjs",
      `--leaderboard=${leaderboardPath}`,
      `--input=${inputPath}`,
      `--matches=${matchesPath}`,
      `--out=${outPath}`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
  assert.equal(differentialRun.status, 0, differentialRun.stderr || differentialRun.stdout)

  const report = JSON.parse(await fs.readFile(outPath, "utf8"))
  assert.equal(report.positiveRowCount, 1)
  assert.equal(report.negativeRowCount, 1)
  assert(report.sharedTpNotFp.some((row) => row.token === "tag:test:tp_only"))
  assert(report.sharedFpNotTp.some((row) => row.token === "tag:test:fp_only"))

  console.log("ok")
}

await main()
