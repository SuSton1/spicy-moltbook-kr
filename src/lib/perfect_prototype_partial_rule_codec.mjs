import path from "node:path"

import { readJsonIfExistsStrict, writeJsonAtomic } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  PERFECT_PROTOTYPE_PARTIAL_RULES_SINK_SCHEMA,
  deserializePerfectPrototypePartialRuleRow,
  serializePerfectPrototypePartialRuleRow,
} from "./perfect_prototype_structured_sink_schemas.mjs"

export const PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME = "partial_rules.parquet"
export const PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME = "live_partial_rules.json"

export const writePerfectPrototypePartialRulesParquet = async ({
  cwd = process.cwd(),
  outDir,
  rules,
}) => {
  const partialRuleSinkMode =
    String(process.env.PREJUMP_PARTIAL_RULE_SINK_MODE ?? process.env.PREJUMP_PRIMARY_SINK_MODE ?? "structured")
      .trim()
      .toLowerCase() || "structured"
  if (partialRuleSinkMode !== "structured") {
    throw new Error(
      `Perfect prototype partial-rule sink mode must remain structured: ${partialRuleSinkMode}`,
    )
  }
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const parquetPath = path.join(path.resolve(outDir), PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME)
  const sink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_PARTIAL_RULES_SINK_SCHEMA,
  })
  try {
    for (const rule of Array.isArray(rules) ? rules : []) {
      await sink.writeRow(serializePerfectPrototypePartialRuleRow(rule))
    }
    await sink.close()
  } catch (error) {
    await sink.abort()
    throw error
  }
  return parquetPath
}

export const streamPerfectPrototypePartialRulesParquet = async ({
  cwd = process.cwd(),
  parquetPath,
  onRule,
}) => {
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath: path.resolve(parquetPath),
    schema: PERFECT_PROTOTYPE_PARTIAL_RULES_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_PARTIAL_RULES_SINK_SCHEMA),
    orderBySql: "ruleId",
    onRow: async (row) => {
      await onRule(deserializePerfectPrototypePartialRuleRow(row))
    },
  })
}

export const writePerfectPrototypeLivePartialRulesSnapshot = async ({
  outDir,
  snapshot,
}) => {
  const snapshotPath = path.join(path.resolve(outDir), PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME)
  await writeJsonAtomic(snapshotPath, snapshot)
  return snapshotPath
}

export const readPerfectPrototypeLivePartialRulesSnapshotIfExists = async ({
  snapshotPath,
}) => readJsonIfExistsStrict(path.resolve(snapshotPath))
