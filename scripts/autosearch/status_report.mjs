import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"

const rootDir = process.cwd()

const toNumber = (value, fallback) => parseNumberArg(value) ?? fallback

const parseArgs = () => {
  const argv = process.argv.slice(2)
  const getValue = (key) => getArgValue(argv, key)
  return {
    sessionId: String(getValue("--sessionId") ?? "").trim(),
    json: hasFlag(argv, "--json") || toNumber(getValue("--json"), 0) === 1,
    riskLimit: Math.max(
      1,
      Math.min(50, Math.floor(toNumber(getValue("--riskLimit"), 5))),
    ),
    milestoneLimit: Math.max(
      1,
      Math.min(50, Math.floor(toNumber(getValue("--milestoneLimit"), 5))),
    ),
    staleMinutes: Math.max(
      1,
      Math.min(24 * 60, Math.floor(toNumber(getValue("--staleMinutes"), 45))),
    ),
  }
}

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const readNdjsonTailSafe = (filePath, limit = 10) => {
  const maxRows = Math.max(0, Math.floor(Number(limit) || 0))
  if (maxRows <= 0 || !filePath || !fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, "utf8").split(/\n+/)
  const rows = []
  for (let i = lines.length - 1; i >= 0 && rows.length < maxRows; i -= 1) {
    const line = String(lines[i] ?? "").trim()
    if (!line) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      // ignore malformed line
    }
  }
  return rows.reverse()
}

const isProcessAlive = (pid) => {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 1) return false
  try {
    process.kill(Math.floor(n), 0)
    return true
  } catch {
    return false
  }
}

const resolveLatestSessionDir = ({ automationRootDir, sessionId }) => {
  if (sessionId) {
    const direct = path.join(automationRootDir, sessionId)
    return fs.existsSync(direct) ? direct : null
  }
  const latestPath = path.join(automationRootDir, "_index", "latest.json")
  const latest = readJsonSafe(latestPath)
  const latestDir = String(latest?.sessionDir ?? "").trim()
  if (latestDir && fs.existsSync(latestDir)) {
    return latestDir
  }
  const children = fs
    .readdirSync(automationRootDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("auto_") &&
        entry.name !== "_index",
    )
    .map((entry) => {
      const dir = path.join(automationRootDir, entry.name)
      const stat = fs.statSync(dir)
      return { dir, mtimeMs: Number(stat.mtimeMs ?? 0) || 0 }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return children[0]?.dir ?? null
}

const recommendAction = ({ status, stale, lastFailureCode }) => {
  const normalizedFailureCode = String(lastFailureCode ?? "")
    .trim()
    .toUpperCase()
  if (status === "SUCCESS" || status === "SUCCESS_DRY") {
    return "정상 완료. 다음 주기 모니터링만 진행."
  }
  if (stale) {
    return "프로세스 재시작 후 status_report로 상태 재확인."
  }
  if (normalizedFailureCode === "WORST2W_BELOW_THRESHOLD") {
    return "룰 고정이면 탐색 반복 유지, 실패 패턴 고착 여부 점검."
  }
  if (normalizedFailureCode === "SURGE_POOL_EMPTY") {
    return "후보풀 부족 진단(stage1_summary/prefilter) 확인."
  }
  if (normalizedFailureCode.startsWith("INSUFFICIENT_POOL")) {
    return "후보는 있으나 품질게이트 미통과. rescue 사유/seed·lane 다양화 추적."
  }
  if (normalizedFailureCode === "OOM_RISK" || status === "FAILED_CRASH") {
    return "메모리 헤드룸/병렬도/라운드 상한 재점검."
  }
  return "최근 리스크 로그를 기준으로 원인 우선순위부터 조치."
}

const run = () => {
  assertServerOnly({ script: "autosearch/status_report" })
  const args = parseArgs()
  const automationRootDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_automation",
  )
  const sessionDir = resolveLatestSessionDir({
    automationRootDir,
    sessionId: args.sessionId,
  })
  if (!sessionDir) {
    console.log("status: NOT_FOUND")
    console.log("reason: session directory not found")
    process.exitCode = 2
    return
  }
  const sessionManifest =
    readJsonSafe(path.join(sessionDir, "session_manifest.json")) ?? {}
  const progress =
    readJsonSafe(path.join(sessionDir, "session_progress.json")) ?? {}
  const finalResult = readJsonSafe(path.join(sessionDir, "final_result.json"))
  const heartbeat = readJsonSafe(path.join(sessionDir, "heartbeat.json")) ?? {}
  const risks = readNdjsonTailSafe(
    path.join(sessionDir, "risk_events.ndjson"),
    args.riskLimit,
  )
  const milestones = readNdjsonTailSafe(
    path.join(sessionDir, "milestones.ndjson"),
    args.milestoneLimit,
  )
  const heartbeatTs = String(
    heartbeat?.updatedAt ?? progress?.lastUpdatedAt ?? "",
  ).trim()
  const heartbeatMs = Date.parse(heartbeatTs)
  const staleThresholdMs = args.staleMinutes * 60 * 1000
  const ageMs = Number.isFinite(heartbeatMs)
    ? Date.now() - heartbeatMs
    : Number.NaN
  const pid = Number(heartbeat?.pid ?? progress?.pid ?? 0) || 0
  const alive = isProcessAlive(pid)
  const stale =
    !finalResult && Number.isFinite(ageMs) && ageMs > staleThresholdMs && !alive
  const status = String(
    finalResult?.result?.status ?? progress?.status ?? "UNKNOWN",
  ).trim()
  const lastFailureCode = String(progress?.lastFailureCode ?? "").trim() || null
  const recommendationsDir = path.join(rootDir, "output", "recommendations")
  const latestIntraday = readJsonSafe(
    path.join(recommendationsDir, "latest_intraday_1500.json"),
  )
  const latestEod = readJsonSafe(
    path.join(recommendationsDir, "latest_eod_close.json"),
  )
  const readRecommendationRows = (value) =>
    Array.isArray(value?.recommendations) ? value.recommendations : []
  const readEmptyReasons = (value) =>
    Array.isArray(value?.emptyRecommendationReasons)
      ? value.emptyRecommendationReasons
      : []
  const intradayRows = readRecommendationRows(latestIntraday)
  const eodRows = readRecommendationRows(latestEod)
  const recommendationCountByMode = {
    INTRADAY_1500: intradayRows.length,
    EOD_CLOSE: eodRows.length,
  }
  const emptyReasonByModeAndTrack = {
    INTRADAY_1500: {
      GAP_15_BET:
        intradayRows.length > 0 ? [] : readEmptyReasons(latestIntraday),
    },
    EOD_CLOSE: {
      SURGE_EOD: eodRows.some(
        (row) =>
          String(row?.track ?? "")
            .trim()
            .toUpperCase() === "SURGE_EOD",
      )
        ? []
        : readEmptyReasons(latestEod),
      MOONSHOT: eodRows.some(
        (row) =>
          String(row?.track ?? "")
            .trim()
            .toUpperCase() === "MOONSHOT",
      )
        ? []
        : readEmptyReasons(latestEod),
    },
  }

  const payload = {
    sessionId:
      String(
        progress?.sessionId ??
          sessionManifest?.sessionId ??
          path.basename(sessionDir),
      ) || null,
    sessionDir,
    status,
    stale,
    staleSeconds: stale ? Math.floor(ageMs / 1000) : 0,
    process: {
      pid,
      alive,
      heartbeatUpdatedAt: heartbeatTs || null,
      heartbeatAgeSeconds: Number.isFinite(ageMs)
        ? Math.floor(ageMs / 1000)
        : null,
    },
    progress: {
      currentAttempt: Number(progress?.currentAttempt ?? 0) || 0,
      attemptsStarted: Number(progress?.attemptsStarted ?? 0) || 0,
      attemptsCompleted: Number(progress?.attemptsCompleted ?? 0) || 0,
      lastStage: progress?.lastStage ?? null,
      lastFailureCode,
      lastFailureDetail: progress?.lastFailureDetail ?? null,
      lastPassedStage: progress?.lastPassedStage ?? null,
      passCount: Number(progress?.passCount ?? 0) || 0,
      failCount: Number(progress?.failCount ?? 0) || 0,
      riskEventsCount: Number(progress?.riskEventsCount ?? 0) || 0,
      lastSignalsLoaded: Number(progress?.lastSignalsLoaded ?? 0) || 0,
      lastSignalsQualified: Number(progress?.lastSignalsQualified ?? 0) || 0,
      lastUniverseSize: Number(progress?.lastUniverseSize ?? 0) || 0,
      lastWeekCount: Number(progress?.lastWeekCount ?? 0) || 0,
      lastPoolSize: Number(progress?.lastPoolSize ?? 0) || 0,
      lastPoolSizeByTrack:
        progress?.lastPoolSizeByTrack &&
        typeof progress.lastPoolSizeByTrack === "object"
          ? progress.lastPoolSizeByTrack
          : {},
      lastPoolAliveByTrack:
        progress?.lastPoolAliveByTrack &&
        typeof progress.lastPoolAliveByTrack === "object"
          ? progress.lastPoolAliveByTrack
          : {},
      lastPoolPassByTrack:
        progress?.lastPoolPassByTrack &&
        typeof progress.lastPoolPassByTrack === "object"
          ? progress.lastPoolPassByTrack
          : {},
      lastPoolRefillByTrack:
        progress?.lastPoolRefillByTrack &&
        typeof progress.lastPoolRefillByTrack === "object"
          ? progress.lastPoolRefillByTrack
          : {},
      lastSelectedPoolCandidateByTrack:
        progress?.lastSelectedPoolCandidateByTrack &&
        typeof progress.lastSelectedPoolCandidateByTrack === "object"
          ? progress.lastSelectedPoolCandidateByTrack
          : {},
      lastSelectedPoolSetByTrack:
        progress?.lastSelectedPoolSetByTrack &&
        typeof progress.lastSelectedPoolSetByTrack === "object"
          ? progress.lastSelectedPoolSetByTrack
          : {},
      lastSelectedMemberByTrack:
        progress?.lastSelectedMemberByTrack &&
        typeof progress.lastSelectedMemberByTrack === "object"
          ? progress.lastSelectedMemberByTrack
          : {},
      lastPoolSetAliveByTrack:
        progress?.lastPoolSetAliveByTrack &&
        typeof progress.lastPoolSetAliveByTrack === "object"
          ? progress.lastPoolSetAliveByTrack
          : {},
      lastPoolSetPassRateByTrack:
        progress?.lastPoolSetPassRateByTrack &&
        typeof progress.lastPoolSetPassRateByTrack === "object"
          ? progress.lastPoolSetPassRateByTrack
          : {},
      lastPoolSetPlannedByTrack:
        progress?.lastPoolSetPlannedByTrack &&
        typeof progress.lastPoolSetPlannedByTrack === "object"
          ? progress.lastPoolSetPlannedByTrack
          : {},
      lastPoolSetEvaluatedByTrack:
        progress?.lastPoolSetEvaluatedByTrack &&
        typeof progress.lastPoolSetEvaluatedByTrack === "object"
          ? progress.lastPoolSetEvaluatedByTrack
          : {},
      lastStage2VariantTotal:
        Number(progress?.lastStage2VariantTotal ?? 0) || 0,
      lastStage2VariantEvalLimit:
        Number(progress?.lastStage2VariantEvalLimit ?? 0) || 0,
      lastStage2EvaluatedVariantIds: Array.isArray(
        progress?.lastStage2EvaluatedVariantIds,
      )
        ? progress.lastStage2EvaluatedVariantIds
        : [],
      lastStage2PassDensity: Number(progress?.lastStage2PassDensity ?? 0) || 0,
      lastStage2TerminalRatio:
        Number(progress?.lastStage2TerminalRatio ?? 0) || 0,
      lastStage2PeakRamMb: Number(progress?.lastStage2PeakRamMb ?? 0) || 0,
      lastTimeToFirstPassSec:
        Number(progress?.lastTimeToFirstPassSec ?? 0) || 0,
      lastStage2ExecCount: Number(progress?.lastStage2ExecCount ?? 0) || 0,
      lastStage2CacheHitCount:
        Number(progress?.lastStage2CacheHitCount ?? 0) || 0,
      lastStage2CacheHitRate:
        Number(progress?.lastStage2CacheHitRate ?? 0) || 0,
      lastStage2DuplicateSkipCount:
        Number(progress?.lastStage2DuplicateSkipCount ?? 0) || 0,
      lastChampionVsDiscoveryPassShare:
        progress?.lastChampionVsDiscoveryPassShare &&
        typeof progress.lastChampionVsDiscoveryPassShare === "object"
          ? progress.lastChampionVsDiscoveryPassShare
          : {},
      recommendationCountByMode,
      emptyReasonByModeAndTrack,
    },
    finalResult: finalResult?.result ?? null,
    recentMilestones: milestones,
    recentRisks: risks,
    recommendedAction: recommendAction({
      status,
      stale,
      lastFailureCode,
    }),
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`sessionId: ${payload.sessionId}`)
  console.log(`status: ${payload.status}${payload.stale ? " (STALE)" : ""}`)
  console.log(
    `attempt: ${payload.progress.currentAttempt} (started=${payload.progress.attemptsStarted}, completed=${payload.progress.attemptsCompleted})`,
  )
  console.log(`lastStage: ${payload.progress.lastStage ?? "-"}`)
  console.log(`lastPassed: ${payload.progress.lastPassedStage ?? "-"}`)
  console.log(`lastFailure: ${payload.progress.lastFailureCode ?? "-"}`)
  if (payload.progress.lastFailureDetail) {
    console.log(`failureDetail: ${payload.progress.lastFailureDetail}`)
  }
  if (
    payload.progress.lastSignalsLoaded > 0 ||
    payload.progress.lastPoolSize > 0
  ) {
    console.log(
      `funnel: loaded=${payload.progress.lastSignalsLoaded} qualified=${payload.progress.lastSignalsQualified} universe=${payload.progress.lastUniverseSize} weeks=${payload.progress.lastWeekCount} pool=${payload.progress.lastPoolSize}`,
    )
    console.log(
      `poolByTrack: size=${JSON.stringify(payload.progress.lastPoolSizeByTrack)} alive=${JSON.stringify(payload.progress.lastPoolAliveByTrack)} pass=${JSON.stringify(payload.progress.lastPoolPassByTrack)}`,
    )
    console.log(
      `poolRefillByTrack: ${JSON.stringify(payload.progress.lastPoolRefillByTrack)}`,
    )
    console.log(
      `poolSetByTrack: alive=${JSON.stringify(payload.progress.lastPoolSetAliveByTrack)} planned=${JSON.stringify(payload.progress.lastPoolSetPlannedByTrack)} evaluated=${JSON.stringify(payload.progress.lastPoolSetEvaluatedByTrack)} passRate=${JSON.stringify(payload.progress.lastPoolSetPassRateByTrack)}`,
    )
    console.log(
      `stage2PoolsetStats: passDensity=${payload.progress.lastStage2PassDensity ?? 0} terminalRatio=${payload.progress.lastStage2TerminalRatio ?? 0} peakRamMb=${payload.progress.lastStage2PeakRamMb ?? 0}`,
    )
    console.log(
      `stage2Speed: timeToFirstPassSec=${payload.progress.lastTimeToFirstPassSec ?? 0} execCount=${payload.progress.lastStage2ExecCount ?? 0} cacheHitCount=${payload.progress.lastStage2CacheHitCount ?? 0} cacheHitRate=${payload.progress.lastStage2CacheHitRate ?? 0} duplicateSkipCount=${payload.progress.lastStage2DuplicateSkipCount ?? 0}`,
    )
    console.log(
      `championVsDiscoveryPassShare: ${JSON.stringify(payload.progress.lastChampionVsDiscoveryPassShare)}`,
    )
    console.log(
      `stage2Variants: total=${payload.progress.lastStage2VariantTotal} evalLimit=${payload.progress.lastStage2VariantEvalLimit} evaluated=${JSON.stringify(payload.progress.lastStage2EvaluatedVariantIds)}`,
    )
    console.log(
      `selectedPoolSetByTrack: ${JSON.stringify(payload.progress.lastSelectedPoolSetByTrack)}`,
    )
    console.log(
      `selectedMemberByTrack: ${JSON.stringify(payload.progress.lastSelectedMemberByTrack)}`,
    )
    console.log(
      `selectedPoolCandidate: ${JSON.stringify(payload.progress.lastSelectedPoolCandidateByTrack)}`,
    )
    console.log(
      `recommendationCountByMode: ${JSON.stringify(payload.progress.recommendationCountByMode)}`,
    )
    console.log(
      `emptyReasonByModeAndTrack: ${JSON.stringify(payload.progress.emptyReasonByModeAndTrack)}`,
    )
  }
  console.log(
    `process: pid=${payload.process.pid || "-"} alive=${payload.process.alive ? "yes" : "no"} heartbeatAgeSec=${payload.process.heartbeatAgeSeconds ?? "-"}`,
  )
  console.log(`recommendedAction: ${payload.recommendedAction}`)
  console.log("")
  console.log("recentMilestones:")
  if (payload.recentMilestones.length === 0) {
    console.log("- (none)")
  } else {
    for (const row of payload.recentMilestones) {
      console.log(
        `- ${row?.ts ?? "unknown"} | ${row?.status ?? "UNKNOWN"} | ${row?.name ?? "UNKNOWN"} | attempt=${row?.attempt ?? "?"} stage=${row?.stage ?? "?"}`,
      )
    }
  }
  console.log("")
  console.log("recentRisks:")
  if (payload.recentRisks.length === 0) {
    console.log("- (none)")
  } else {
    for (const row of payload.recentRisks) {
      console.log(
        `- ${row?.ts ?? "unknown"} | ${row?.severity ?? "WARN"} | ${row?.code ?? "UNKNOWN"} | attempt=${row?.attempt ?? "?"} stage=${row?.stage ?? "?"} | ${row?.summary ?? ""}`,
      )
    }
  }
}

run()
