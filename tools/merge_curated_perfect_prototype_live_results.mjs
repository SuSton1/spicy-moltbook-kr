import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { ensureDir, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text) return text
  }
  return null
}

const normalizeRow = (row, sourceLabel) => ({
  sourceLabel,
  dateKey: String(row?.dateKey ?? row?.recommendationDateKey ?? "").trim(),
  recommendationDateKey: String(row?.recommendationDateKey ?? row?.dateKey ?? "").trim(),
  symbol: String(row?.symbol ?? "").trim(),
  name: firstNonEmpty(row?.name, row?.symbolName),
  asOfDateKey: firstNonEmpty(row?.asOfDateKey),
  entryDateKey: firstNonEmpty(row?.entryDateKey),
  exitDateKey: firstNonEmpty(row?.exitDateKey),
  matchedRuleIds: uniqueSorted(row?.matchedRuleIds),
  primaryRuleId: firstNonEmpty(row?.primaryRuleId),
})

const toSingleOrNull = (values) => {
  const unique = uniqueSorted(values)
  if (unique.length === 1) return unique[0]
  return null
}

const mergeSourceRows = ({ parentRows, stepbRows }) => {
  const combined = new Map()

  const ingest = (rows, sourceLabel) => {
    for (const rawRow of Array.isArray(rows) ? rows : []) {
      const row = normalizeRow(rawRow, sourceLabel)
      if (!row.dateKey || !row.symbol) continue
      const key = `${row.dateKey}::${row.symbol}`
      const previous = combined.get(key)
      if (!previous) {
        combined.set(key, {
          dateKey: row.dateKey,
          recommendationDateKey: row.recommendationDateKey || row.dateKey,
          symbol: row.symbol,
          name: row.name,
          matchedSources: [sourceLabel],
          parentRuleIds: sourceLabel === "rule2_parent" ? row.matchedRuleIds : [],
          stepbRuleIds: sourceLabel === "stepb_shortlist171" ? row.matchedRuleIds : [],
          parentPrimaryRuleId: sourceLabel === "rule2_parent" ? row.primaryRuleId : null,
          stepbPrimaryRuleId: sourceLabel === "stepb_shortlist171" ? row.primaryRuleId : null,
          asOfDateKeys: row.asOfDateKey ? [row.asOfDateKey] : [],
          entryDateKeys: row.entryDateKey ? [row.entryDateKey] : [],
          exitDateKeys: row.exitDateKey ? [row.exitDateKey] : [],
        })
        continue
      }

      previous.name = previous.name || row.name
      previous.matchedSources = uniqueSorted([...previous.matchedSources, sourceLabel])
      previous.parentRuleIds =
        sourceLabel === "rule2_parent"
          ? uniqueSorted([...previous.parentRuleIds, ...row.matchedRuleIds])
          : previous.parentRuleIds
      previous.stepbRuleIds =
        sourceLabel === "stepb_shortlist171"
          ? uniqueSorted([...previous.stepbRuleIds, ...row.matchedRuleIds])
          : previous.stepbRuleIds
      previous.parentPrimaryRuleId =
        previous.parentPrimaryRuleId || (sourceLabel === "rule2_parent" ? row.primaryRuleId : null)
      previous.stepbPrimaryRuleId =
        previous.stepbPrimaryRuleId || (sourceLabel === "stepb_shortlist171" ? row.primaryRuleId : null)
      previous.asOfDateKeys = uniqueSorted([...previous.asOfDateKeys, row.asOfDateKey])
      previous.entryDateKeys = uniqueSorted([...previous.entryDateKeys, row.entryDateKey])
      previous.exitDateKeys = uniqueSorted([...previous.exitDateKeys, row.exitDateKey])
    }
  }

  ingest(parentRows, "rule2_parent")
  ingest(stepbRows, "stepb_shortlist171")

  return Array.from(combined.values())
    .map((row) => {
      const matchedRuleIds = uniqueSorted([...row.parentRuleIds, ...row.stepbRuleIds])
      const parentMatchedRuleCount = row.parentRuleIds.length
      const stepbMatchedRuleCount = row.stepbRuleIds.length
      return {
        dateKey: row.dateKey,
        recommendationDateKey: row.recommendationDateKey,
        symbol: row.symbol,
        name: row.name || null,
        primarySource:
          row.matchedSources.length > 1 ? "both" : String(row.matchedSources[0] ?? "unknown"),
        matchedSources: row.matchedSources,
        matchedRuleIds,
        matchedRuleCount: matchedRuleIds.length,
        parentRuleIds: row.parentRuleIds,
        parentMatchedRuleCount,
        parentPrimaryRuleId: row.parentPrimaryRuleId,
        stepbRuleIds: row.stepbRuleIds,
        stepbMatchedRuleCount,
        stepbPrimaryRuleId: row.stepbPrimaryRuleId,
        asOfDateKeys: row.asOfDateKeys,
        asOfDateKey: toSingleOrNull(row.asOfDateKeys),
        entryDateKeys: row.entryDateKeys,
        entryDateKey: toSingleOrNull(row.entryDateKeys),
        exitDateKeys: row.exitDateKeys,
        exitDateKey: toSingleOrNull(row.exitDateKeys),
      }
    })
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey))
      return String(left.symbol).localeCompare(String(right.symbol))
    })
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "merge_curated_perfect_prototype_live_results",
  })
  const parentInputPath = path.resolve(String(getFlag(parsed.flags, "parent-input", "")).trim())
  const stepbInputPath = path.resolve(String(getFlag(parsed.flags, "stepb-input", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const targetDate = String(getFlag(parsed.flags, "date", "")).trim() || null
  const parentCatalogPath = String(getFlag(parsed.flags, "parent-catalog", "")).trim() || null
  const stepbCatalogPath = String(getFlag(parsed.flags, "stepb-catalog", "")).trim() || null
  const parentRunId = String(getFlag(parsed.flags, "parent-run-id", "")).trim() || null
  const stepbRunId = String(getFlag(parsed.flags, "stepb-run-id", "")).trim() || null

  if (!parentInputPath || !stepbInputPath || !outDir) {
    throw new Error(
      "Usage: node tools/merge_curated_perfect_prototype_live_results.mjs --parent-input=<deduped_symbols.jsonl> --stepb-input=<deduped_symbols.jsonl> --out-dir=<dir> [--date=YYYY-MM-DD]",
    )
  }

  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "parentInput", filePath: parentInputPath },
      { label: "stepbInput", filePath: stepbInputPath },
      { label: "outDir", filePath: outDir },
      { label: "parentCatalog", filePath: parentCatalogPath },
      { label: "stepbCatalog", filePath: stepbCatalogPath },
    ],
    policy: serverPolicy,
    toolName: "merge_curated_perfect_prototype_live_results",
  })

  const parentRows = await readJsonl(parentInputPath)
  const stepbRows = await readJsonl(stepbInputPath)
  const combinedRows = mergeSourceRows({ parentRows, stepbRows })

  const bothCount = combinedRows.filter((row) => row.matchedSources.length > 1).length
  const parentOnlyCount = combinedRows.filter(
    (row) => row.matchedSources.length === 1 && row.matchedSources[0] === "rule2_parent",
  ).length
  const stepbOnlyCount = combinedRows.filter(
    (row) => row.matchedSources.length === 1 && row.matchedSources[0] === "stepb_shortlist171",
  ).length

  await ensureDir(outDir)
  await writeJsonl(path.join(outDir, "combined_deduped_symbols.jsonl"), combinedRows)
  await writeJson(path.join(outDir, "combined_summary.json"), {
    dateKey: targetDate,
    parentInputPath,
    stepbInputPath,
    parentCatalogPath,
    stepbCatalogPath,
    parentRunId,
    stepbRunId,
    parentRows: parentRows.length,
    stepbRows: stepbRows.length,
    combinedRows: combinedRows.length,
    overlapCount: bothCount,
    parentOnlyCount,
    stepbOnlyCount,
    bothCount,
    uniqueSymbols: uniqueSorted(combinedRows.map((row) => row.symbol)).length,
    uniqueDates: uniqueSorted(combinedRows.map((row) => row.dateKey)).length,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
