import path from "node:path"
import fsp from "node:fs/promises"

import {
  buildCandleDateIndexMap,
  buildCandleSeriesMap,
  loadStepBData
} from "../lib/data.mjs"
import { normalizeDateKey } from "../lib/date.mjs"
import {
  renderCandlestickChartSvg,
  renderConsensusChartSvg,
  renderFamilyHtml,
  renderIndexHtml
} from "../lib/family_chart_renderer.mjs"
import { ensureDir, readJson, readJsonl, writeJson } from "../lib/io.mjs"
import { dequantizeSequence, resolveStepC0InputPath } from "../lib/lightweight.mjs"
import { scoreTemplatePairForFamily } from "../lib/similarity.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const average = (values) => {
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite)
  if (!list.length) return null
  return list.reduce((sum, value) => sum + value, 0) / list.length
}

const stdev = (values) => {
  const mean = average(values)
  if (!Number.isFinite(mean)) return null
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite)
  if (list.length < 2) return 0
  const variance = list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / list.length
  return Math.sqrt(variance)
}

const clamp01 = (value) => {
  const n = num(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

const toInt = (value, fallback) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const normalizeTemplateRow = (row) => {
  const seq40 =
    Array.isArray(row?.seq40) && row.seq40.length
      ? row.seq40.map((value) => num(value) ?? 0)
      : dequantizeSequence(row?.seq40q, row?.seq40Scale ?? 10000)
  const seq150 =
    Array.isArray(row?.seq150) && row.seq150.length
      ? row.seq150.map((value) => num(value) ?? 0)
      : dequantizeSequence(row?.seq150q, row?.seq150Scale ?? 10000)
  const featureVec = row?.featureVec && typeof row.featureVec === "object" ? row.featureVec : {}
  const globalFeatureVec =
    row?.globalFeatureVec && typeof row.globalFeatureVec === "object" ? row.globalFeatureVec : {}
  return {
    templateId: String(row?.templateId ?? "").trim() || null,
    symbol: String(row?.symbol ?? "").trim() || null,
    eventDate: normalizeDateKey(row?.eventDate) ?? null,
    asOfDate: normalizeDateKey(row?.asOfDate) ?? null,
    featureVec,
    globalFeatureVec,
    seq40,
    seq150,
    eventMeta: row?.eventMeta && typeof row.eventMeta === "object" ? row.eventMeta : {},
    eventOutcome: row?.eventOutcome && typeof row.eventOutcome === "object" ? row.eventOutcome : {},
    label: Number(row?.label ?? 0) || 0,
    templateKind: String(row?.templateKind ?? "").trim().toUpperCase() || "UNKNOWN"
  }
}

const buildFeatureStats = (rows, vectorKey) => {
  const byKey = new Map()
  for (const row of rows ?? []) {
    for (const [key, value] of Object.entries(row?.[vectorKey] ?? {})) {
      const n = num(value)
      if (!Number.isFinite(n)) continue
      const list = byKey.get(key) ?? []
      list.push(n)
      byKey.set(key, list)
    }
  }
  const out = {}
  for (const [key, values] of byKey.entries()) {
    out[key] = {
      mean: average(values) ?? 0,
      stdev: stdev(values) ?? 0
    }
  }
  return out
}

const buildMovingAverageSeries = (series, period) => {
  const out = new Array(series.length).fill(null)
  const safePeriod = Math.max(1, Number(period) || 1)
  let rolling = 0
  for (let idx = 0; idx < series.length; idx += 1) {
    const close = num(series[idx]?.close) ?? 0
    rolling += close
    if (idx >= safePeriod) {
      rolling -= num(series[idx - safePeriod]?.close) ?? 0
    }
    if (idx >= safePeriod - 1) {
      out[idx] = rolling / safePeriod
    }
  }
  return out
}

const buildConsensusSeries = (members, seqKey) => {
  const seqs = (Array.isArray(members) ? members : [])
    .map((row) => (Array.isArray(row?.[seqKey]) ? row[seqKey] : []))
    .filter((seq) => seq.length > 0)
  if (!seqs.length) {
    return {
      mean: [],
      stdev: [],
      representative: []
    }
  }
  const length = Math.max(...seqs.map((seq) => seq.length))
  const mean = []
  const spread = []
  for (let idx = 0; idx < length; idx += 1) {
    const bucket = seqs.map((seq) => num(seq[idx])).filter(Number.isFinite)
    mean.push(average(bucket) ?? 0)
    spread.push(stdev(bucket) ?? 0)
  }
  return {
    mean,
    stdev: spread
  }
}

const signatureToken = (signature, prefix) => {
  const tokens = String(signature ?? "")
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean)
  return tokens.find((token) => token.startsWith(prefix)) ?? null
}

const summarizeShape = (signature) => {
  const token = signatureToken(signature, "shape:")
  if (!token) return "Mixed shape profile"
  if (token.includes("UP")) return "Upward continuation family"
  if (token.includes("DOWN")) return "Pullback / downward drift family"
  return "Sideways / mixed shape family"
}

const summarizeJump = (signature) => {
  const token = signatureToken(signature, "jump:")
  if (!token) return "Mixed jump size"
  if (token.endsWith("HIGH")) return "High jump amplitude"
  if (token.endsWith("MID")) return "Mid jump amplitude"
  return "Lower jump amplitude"
}

const buildExplanation = ({ family, members, representative }) => {
  const avgCloseOver20 = average(members.map((row) => row?.featureVec?.["trend.closeOverMa20"]))
  const avgCloseOver120 = average(members.map((row) => row?.featureVec?.["trend.closeOverMa120"]))
  const avgDryUp = average(members.map((row) => row?.featureVec?.["volume.dryUp20Over40"]))
  const avgSlope10 = average(members.map((row) => row?.featureVec?.["trend.slope10"]))
  const avgJump = average(members.map((row) => row?.eventMeta?.jumpPct))
  const tags = [
    family?.familyId,
    summarizeShape(family?.signature),
    summarizeJump(family?.signature),
    `support ${family?.support ?? 0}`,
    `${family?.symbolCount ?? 0} symbols`
  ]
  const bullets = []
  bullets.push(`${summarizeShape(family?.signature)} across ${family?.support ?? 0} matched templates.`)
  bullets.push(`${summarizeJump(family?.signature)} with average jump size around ${((avgJump ?? 0) * 100).toFixed(2)}%.`)
  if (Number.isFinite(avgCloseOver20)) {
    bullets.push(
      avgCloseOver20 >= 0
        ? "Members usually sit above the 20-day average into the event."
        : "Members usually approach the event below the 20-day average.",
    )
  }
  if (Number.isFinite(avgCloseOver120)) {
    bullets.push(
      avgCloseOver120 >= 0
        ? "The longer trend often stays above the 120-day line."
        : "The longer trend often remains below the 120-day line.",
    )
  }
  if (Number.isFinite(avgDryUp)) {
    bullets.push(
      avgDryUp < 1
        ? "Volume usually dries up before the event compared with the earlier 40-day backdrop."
        : "Volume tends to stay elevated into the event.",
    )
  }
  if (Number.isFinite(avgSlope10)) {
    bullets.push(
      avgSlope10 >= 0
        ? "The short moving structure is generally tilting upward."
        : "The short moving structure is generally tilting downward before the jump.",
    )
  }
  const summary = `Representative chart is selected as the most central member inside ${family?.familyId} by full intra-family similarity.`
  const headline = `${summarizeShape(family?.signature)} · ${representative?.symbol ?? "representative"}`
  return {
    headline,
    summary,
    tags,
    bullets
  }
}

const selectRepresentative = ({ family, members, featureStats, weights }) => {
  const safeMembers = Array.isArray(members) ? members.filter(Boolean) : []
  if (!safeMembers.length) return null
  if (safeMembers.length === 1) {
    return {
      ...safeMembers[0],
      representativeMeanSimilarity: 1,
      representativeRank: 1
    }
  }
  const stats = new Map()
  for (const member of safeMembers) {
    stats.set(member.templateId, { sum: 0, count: 0 })
  }
  for (let i = 0; i < safeMembers.length; i += 1) {
    for (let j = i + 1; j < safeMembers.length; j += 1) {
      const left = safeMembers[i]
      const right = safeMembers[j]
      const lr = scoreTemplatePairForFamily({
        left,
        right,
        featureStats,
        weights
      })
      const rl = scoreTemplatePairForFamily({
        left: right,
        right: left,
        featureStats,
        weights
      })
      const sim = average([lr?.total, rl?.total]) ?? 0
      const leftStat = stats.get(left.templateId)
      const rightStat = stats.get(right.templateId)
      leftStat.sum += sim
      leftStat.count += 1
      rightStat.sum += sim
      rightStat.count += 1
    }
  }
  const ranked = safeMembers
    .map((member) => {
      const entry = stats.get(member.templateId) ?? { sum: 0, count: 0 }
      return {
        ...member,
        representativeMeanSimilarity: entry.count > 0 ? entry.sum / entry.count : 0
      }
    })
    .sort((left, right) => {
      const simGap =
        (Number(right?.representativeMeanSimilarity ?? 0) || 0) -
        (Number(left?.representativeMeanSimilarity ?? 0) || 0)
      if (Math.abs(simGap) > 1e-9) return simGap
      const labelGap = (Number(right?.label ?? 0) || 0) - (Number(left?.label ?? 0) || 0)
      if (labelGap !== 0) return labelGap
      return String(left?.templateId ?? "").localeCompare(String(right?.templateId ?? ""))
    })
  return {
    ...ranked[0],
    representativeRank: 1
  }
}

const buildVisibleCandles = ({ series, eventIdx, maPeriods, preDays, postDays }) => {
  const startIdx = Math.max(0, eventIdx - preDays)
  const endIdx = Math.min(series.length - 1, eventIdx + postDays)
  const maByPeriod = Object.fromEntries(
    maPeriods.map((period) => [period, buildMovingAverageSeries(series, period)]),
  )
  const out = []
  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    const candle = series[idx]
    const row = {
      dateKey: candle?.dateKey ?? null,
      open: num(candle?.open),
      high: num(candle?.high),
      low: num(candle?.low),
      close: num(candle?.close),
      volume: num(candle?.volume)
    }
    for (const period of maPeriods) {
      row[`ma${period}`] = num(maByPeriod[period]?.[idx])
    }
    out.push(row)
  }
  return out
}

const loadTemplatesForFamilies = async ({ templatePath, templateIds }) =>
  readJsonl(templatePath, {
    filter: (row) => templateIds.has(String(row?.templateId ?? "").trim()),
    map: normalizeTemplateRow
  })

const pickShortlistedFamilies = (index, familiesLimit) =>
  (Array.isArray(index?.families) ? index.families : [])
    .filter((family) => family?.shortlisted === true)
    .sort((left, right) => {
      const rankGap = (Number(right?.support ?? 0) || 0) - (Number(left?.support ?? 0) || 0)
      if (rankGap !== 0) return rankGap
      return String(left?.familyId ?? "").localeCompare(String(right?.familyId ?? ""))
    })
    .slice(0, familiesLimit)

export const runStepC0ChartReport = async (ctx, flags = {}) => {
  const familiesLimit = toInt(flags?.["families-limit"], 18)
  const preDays = toInt(flags?.["window-before"], 90)
  const postDays = toInt(flags?.["window-after"], 25)
  const maPeriods = [5, 10, 20, 60, 120]
  const outDir = path.join(ctx.runDir, "step-c0-chart")
  const familiesDir = path.join(outDir, "families")
  await ensureDir(familiesDir)

  const indexPath = path.join(ctx.runDir, "step-c0", "c0_family_index.json")
  const membershipPath = path.join(ctx.runDir, "step-c0", "c0_family_membership.jsonl")
  const c0Index = await readJson(indexPath)
  if (!c0Index) {
    throw new Error(`C0 family index missing: ${indexPath}`)
  }

  const shortlistedFamilies = pickShortlistedFamilies(c0Index, familiesLimit)
  const shortlistedFamilyIds = new Set(shortlistedFamilies.map((family) => family.familyId))
  const membershipRows = await readJsonl(membershipPath, {
    filter: (row) => shortlistedFamilyIds.has(String(row?.familyId ?? "").trim())
  })
  const templateIds = new Set(membershipRows.map((row) => String(row?.templateId ?? "").trim()).filter(Boolean))
  const stepBSourceRunDir = String(c0Index?.sourceStepBRunDir ?? ctx.runDir).trim() || ctx.runDir
  const stepBInput = resolveStepC0InputPath({
    runDir: stepBSourceRunDir,
    lightweightCfg: ctx.config?.lightweight,
    preferLiteArtifacts: ctx.config?.lightweight?.pipeline?.preferLiteArtifacts
  })
  const templates = await loadTemplatesForFamilies({
    templatePath: stepBInput.inPath,
    templateIds
  })
  const templateMap = new Map(templates.map((row) => [row.templateId, row]))
  const symbolAllowSet = new Set(templates.map((row) => row.symbol).filter(Boolean))
  const stepBData = await loadStepBData(ctx.config.dataPaths, {
    symbolAllowSet
  })
  const seriesMap = buildCandleSeriesMap(stepBData.candles, symbolAllowSet)
  const dateIndexMap = buildCandleDateIndexMap(seriesMap)
  const positiveTemplates = templates.filter((row) => row.label === 1)
  const localFeatureStats = buildFeatureStats(positiveTemplates, "featureVec")
  const similarityWeights = ctx.config?.similarity?.initialWeights ?? {}

  const generatedFamilies = []

  for (let familyIdx = 0; familyIdx < shortlistedFamilies.length; familyIdx += 1) {
    const family = shortlistedFamilies[familyIdx]
    const familyTemplateIds = membershipRows
      .filter((row) => row.familyId === family.familyId)
      .map((row) => row.templateId)
    const members = familyTemplateIds.map((templateId) => templateMap.get(templateId)).filter(Boolean)
    if (!members.length) {
      continue
    }

    const representative =
      selectRepresentative({
        family,
        members,
        featureStats: localFeatureStats,
        weights: similarityWeights
      }) ??
      templateMap.get(family?.familyRepresentativeTemplateIds?.[0] ?? "")

    const series = seriesMap.get(representative?.symbol ?? "") ?? []
    const dateIndex = dateIndexMap.get(representative?.symbol ?? "") ?? new Map()
    const eventIdx =
      dateIndex.get(representative?.eventDate) ??
      dateIndex.get(representative?.asOfDate) ??
      Math.max(0, series.length - 1)
    const visibleCandles = buildVisibleCandles({
      series,
      eventIdx,
      maPeriods,
      preDays,
      postDays
    })

    const consensusLocal = buildConsensusSeries(members, "seq40")
    const consensusGlobal = buildConsensusSeries(members, "seq150")
    consensusLocal.representative = Array.isArray(representative?.seq40) ? representative.seq40 : []
    consensusGlobal.representative = Array.isArray(representative?.seq150) ? representative.seq150 : []
    const explanation = buildExplanation({
      family,
      members,
      representative
    })

    const representativeSvgFile = `${family.familyId}_representative.svg`
    const consensusSvgFile = `${family.familyId}_consensus.svg`
    const pageFile = `${family.familyId}.html`
    const representativeSvgPath = path.join(familiesDir, representativeSvgFile)
    const consensusSvgPath = path.join(familiesDir, consensusSvgFile)
    const pagePath = path.join(familiesDir, pageFile)

    const representativeSvg = renderCandlestickChartSvg({
      family,
      representative,
      candles: visibleCandles,
      maPeriods,
      title: `${family.familyId} representative chart`,
      subtitle: `${representative?.symbol ?? "n/a"} · event ${representative?.eventDate ?? "n/a"} · support ${family.support} · c0 ${(
        Number(family?.c0Score ?? 0) || 0
      ).toFixed(3)}`
    })
    const consensusSvg = renderConsensusChartSvg({
      family,
      consensusLocal,
      consensusGlobal,
      title: `${family.familyId} family consensus`
    })
    await fsp.writeFile(representativeSvgPath, representativeSvg, "utf8")
    await fsp.writeFile(consensusSvgPath, consensusSvg, "utf8")

    const familyPage = renderFamilyHtml({
      family,
      representative,
      explanation,
      representativeChartFile: representativeSvgFile,
      consensusChartFile: consensusSvgFile,
      shortlistRank: familyIdx + 1
    })
    await fsp.writeFile(pagePath, familyPage, "utf8")

    generatedFamilies.push({
      familyId: family.familyId,
      shortlistRank: familyIdx + 1,
      support: family.support,
      symbolCount: family.symbolCount,
      c0Score: family.c0Score,
      representativeTemplateId: representative?.templateId ?? null,
      representativeSymbol: representative?.symbol ?? null,
      representativeEventDate: representative?.eventDate ?? null,
      representativeMeanSimilarity: representative?.representativeMeanSimilarity ?? null,
      representativeChartFile: path.join("families", representativeSvgFile),
      consensusChartFile: path.join("families", consensusSvgFile),
      pageFile: path.join("families", pageFile),
      headline: explanation.headline,
      summary: explanation.summary,
      tags: explanation.tags
    })
  }

  const summary = {
    step: "C0_CHART",
    enabled: true,
    runId: ctx.runId,
    familiesLimit,
    renderedFamilyCount: generatedFamilies.length,
    sourceStepBRunDir: c0Index?.sourceStepBRunDir ?? null,
    templateInputPath: stepBInput.inPath,
    templateInputMode: stepBInput.mode,
    outputDir: outDir,
    familyPagesDir: familiesDir,
    maPeriods,
    windowBefore: preDays,
    windowAfter: postDays,
    families: generatedFamilies
  }

  const indexHtml = renderIndexHtml({
    families: generatedFamilies.map((family) => ({
      ...family,
      previewFile: family.representativeChartFile
    })),
    title: `C0 shortlisted family chart atlas · ${generatedFamilies.length} families`,
    subtitle:
      "Each card uses the most central member inside the family as the representative stock chart, with raw candles, volume, and 5/10/20/60/120 day moving averages."
  })
  await fsp.writeFile(path.join(outDir, "index.html"), indexHtml, "utf8")
  await writeJson(path.join(outDir, "step_c0_chart_summary.json"), summary)

  return {
    outDir,
    familiesDir,
    summary
  }
}
