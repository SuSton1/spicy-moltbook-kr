import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  resolveTp12NoStopLookbackCandidates,
  TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL,
  TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}

const compareRows = (left, right) => {
  const leftUsable = left?.screen?.enoughUsableScreenWindows === true ? 1 : 0
  const rightUsable = right?.screen?.enoughUsableScreenWindows === true ? 1 : 0
  if (leftUsable !== rightUsable) return rightUsable - leftUsable
  const leftEarlyStop = left?.screen?.earlyStopTriggered === true ? 1 : 0
  const rightEarlyStop = right?.screen?.earlyStopTriggered === true ? 1 : 0
  if (leftEarlyStop !== rightEarlyStop) return leftEarlyStop - rightEarlyStop
  const leftHitRate = toNumber(left?.screen?.primary?.hitRate, -1)
  const rightHitRate = toNumber(right?.screen?.primary?.hitRate, -1)
  if (leftHitRate !== rightHitRate) return rightHitRate - leftHitRate
  const leftSelectedRows = toNumber(left?.screen?.primary?.selectedRows, -1)
  const rightSelectedRows = toNumber(right?.screen?.primary?.selectedRows, -1)
  if (leftSelectedRows !== rightSelectedRows) return rightSelectedRows - leftSelectedRows
  return toNumber(left?.lookbackTradingDays, 0) - toNumber(right?.lookbackTradingDays, 0)
}

export const buildTp12NoStopLookbackLadderSummary = async ({
  ladderContract,
  manifestPath,
  outPath,
} = {}) => {
  const manifest = await readJson(path.resolve(manifestPath ?? ""), null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing lookback ladder manifest: ${manifestPath}`)
  }
  const manifestCandidates = Array.isArray(manifest?.candidates) ? manifest.candidates : []
  if (manifestCandidates.length < 1) {
    throw new Error(`lookback ladder manifest has no candidates: ${manifestPath}`)
  }
  const requestedCandidateIds = Array.isArray(manifest?.requestedCandidateIds)
    ? manifest.requestedCandidateIds.map((value) => toText(value)).filter(Boolean)
    : []
  const selectedCandidates = resolveTp12NoStopLookbackCandidates({
    ladderContract,
    candidateGroup: manifest?.candidateGroup ?? "all",
    candidateIds: requestedCandidateIds,
  })
  if (selectedCandidates.length !== manifestCandidates.length) {
    throw new Error(
      `lookback ladder candidate count mismatch: expected=${selectedCandidates.length} actual=${manifestCandidates.length} path=${manifestPath}`,
    )
  }
  const byId = new Map(selectedCandidates.map((candidate) => [toText(candidate.candidateId), candidate]))
  for (const entry of manifestCandidates) {
    const candidateId = toText(entry?.candidateId)
    if (!byId.has(candidateId)) {
      throw new Error(`lookback ladder manifest carries unexpected candidateId=${candidateId}`)
    }
  }
  const candidateRows = []
  for (const entry of manifestCandidates) {
    const candidateId = toText(entry?.candidateId)
    const candidate = byId.get(candidateId)
    const rollingSummaryPath = path.resolve(toText(entry?.rollingSummaryPath))
    const rollingSummary = await readJson(rollingSummaryPath, null)
    if (!rollingSummary || typeof rollingSummary !== "object") {
      throw new Error(`Missing rolling summary for candidateId=${candidateId}: ${rollingSummaryPath}`)
    }
    candidateRows.push({
      candidateId,
      candidateStage: candidate.stage,
      lookbackTradingDays: candidate.lookbackTradingDays,
      discoveryUniverseId: candidate.discoveryUniverseId,
      stepALaneSet: [...candidate.stepALaneSet],
      candidateRunId: toText(entry?.candidateRunId),
      candidateContractPath: toText(entry?.candidateContractPath),
      rollingSummaryPath,
      rollingReportPath: path.resolve(toText(entry?.rollingReportPath)),
      screen: {
        primary: rollingSummary?.screen?.primary ?? null,
        secondary: rollingSummary?.screen?.secondary ?? null,
        enoughUsableScreenWindows: rollingSummary?.screen?.enoughUsableScreenWindows === true,
        earlyStopTriggered: rollingSummary?.screen?.earlyStopTriggered === true,
      },
      finalConfirm: rollingSummary?.finalConfirm ?? null,
    })
  }
  const sortedRows = [...candidateRows].sort(compareRows)
  const bestCandidate = sortedRows.find(
    (row) => row?.screen?.enoughUsableScreenWindows === true && row?.screen?.earlyStopTriggered !== true,
  ) ?? null
  const summary = {
    kind: "tp12_no_stop_lookback_ladder_summary_v1",
    contractId: toText(ladderContract?.contractId),
    contractPath: toText(ladderContract?.contractPath),
    manifestPath: path.resolve(manifestPath ?? ""),
    runId: toText(manifest?.runId),
    candidateGroup: toText(manifest?.candidateGroup || "all"),
    windowGroup: toText(manifest?.windowGroup || "screen"),
    candidateCount: sortedRows.length,
    sparseCandidateCount: sortedRows.filter((row) => row.candidateStage === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE).length,
    denseFillCandidateCount: sortedRows.filter((row) => row.candidateStage === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL).length,
    bestCandidateId: bestCandidate?.candidateId ?? null,
    candidates: sortedRows,
  }
  const reportLines = [
    "# TP12 No-Stop Lookback Ladder Summary",
    "",
    "## Contract",
    "",
    `- contractId: \`${summary.contractId}\``,
    `- runId: \`${summary.runId}\``,
    `- candidateGroup: \`${summary.candidateGroup}\``,
    `- windowGroup: \`${summary.windowGroup}\``,
    `- bestCandidateId: ${summary.bestCandidateId ? `\`${summary.bestCandidateId}\`` : "none"}`,
    "",
    "## Candidates",
    "",
    ...sortedRows.flatMap((row) => {
      const primary = row?.screen?.primary ?? {}
      const finalPrimary = row?.finalConfirm?.primary ?? null
      return [
        `- ${row.candidateId} [${row.candidateStage}] lookback=${row.lookbackTradingDays}d: screen ${toNumber(primary?.hitRows, 0)}/${toNumber(primary?.selectedRows, 0)} = ${pct(primary?.hitRate)}, usable windows ${toNumber(primary?.usableWindowCount, 0)}/${toNumber(primary?.windowCount, 0)}, earlyStop=${row?.screen?.earlyStopTriggered === true ? "yes" : "no"}` +
          (finalPrimary
            ? `, final ${toNumber(finalPrimary?.hitRows, 0)}/${toNumber(finalPrimary?.selectedRows, 0)} = ${pct(finalPrimary?.hitRate)}`
            : ""),
      ]
    }),
    "",
  ]
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required")
  }
  await ensureDir(path.dirname(resolvedOutPath))
  await writeJson(resolvedOutPath, summary)
  const rankingPath = path.join(path.dirname(resolvedOutPath), "lookback_ladder_ranking.json")
  await writeJson(rankingPath, sortedRows)
  const reportPath = path.join(path.dirname(resolvedOutPath), "lookback_ladder_report.md")
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")
  return {
    outPath: resolvedOutPath,
    reportPath,
    summary,
  }
}
