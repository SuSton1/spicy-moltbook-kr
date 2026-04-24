import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

export const TP12_SELECTOR_FEATURE_SOURCE_REPAIR_KIND = "tp12_selector_feature_source_repair_v1"
export const DEFAULT_SELECTOR_FEATURE_SOURCE_CONTRACT_PATH =
  "meta/tp12_selector_feature_source_repair_contract.json"

const DEFAULT_GATE_ID = "d0_close"

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const keyOf = (symbol, decisionDateKey) => `${decisionDateKey}\t${symbol}`
const joinKeyOf = (row) => keyOf(toText(row?.symbol).toUpperCase(), toText(row?.decisionDateKey ?? row?.dateKey))

const requireDateKey = (value, label) => {
  const text = toText(value)
  if (!validDateKey(text)) throw new Error(`${label} must be YYYY-MM-DD: ${text || "missing"}`)
  return text
}

const requireFinite = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be finite; missing-value zero fill is forbidden`)
  return numeric
}

const uniqueSorted = (values) => [...new Set(values.map((value) => toText(value)).filter(Boolean))].sort()

const compileForbiddenPatterns = (contract) =>
  (Array.isArray(contract?.forbiddenFeatureFieldPatterns) ? contract.forbiddenFeatureFieldPatterns : []).map(
    (pattern) => new RegExp(pattern, "i"),
  )

const forbiddenFieldSet = (contract) =>
  new Set((Array.isArray(contract?.forbiddenFeatureFields) ? contract.forbiddenFeatureFields : []).map((field) => toText(field)))

const assertNoForbiddenFieldNames = ({ value, contract, sourceLabel, keyPath = [] }) => {
  const exact = forbiddenFieldSet(contract)
  const patterns = compileForbiddenPatterns(contract)
  const scan = (item, pathParts) => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => scan(child, [...pathParts, String(index)]))
      return
    }
    if (!isObject(item)) return
    for (const [key, child] of Object.entries(item)) {
      const keyText = toText(key)
      const pathText = [...pathParts, keyText].join(".")
      if (exact.has(keyText) || patterns.some((pattern) => pattern.test(keyText) || pattern.test(pathText))) {
        throw new Error(`${sourceLabel} contains forbidden selector feature/source field: ${pathText}`)
      }
      scan(child, [...pathParts, keyText])
    }
  }
  scan(value, keyPath)
}

const readContract = async (contractPath) => {
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`selector feature source contract not found: ${contractPath}`)
  if (toText(contract.kind) !== "tp12_selector_feature_source_repair_contract_v1") {
    throw new Error(`unsupported selector feature source contract kind: ${contract.kind ?? "missing"}`)
  }
  if (toText(contract.patchKey) !== "tp12_selector_feature_source_repair_v1") {
    throw new Error(`unexpected selector feature source patchKey: ${contract.patchKey ?? "missing"}`)
  }
  return contract
}

const loadGateFeatureLookup = async ({ featurePath, gateId, contract, sourceName, requiredFeatureFields }) => {
  if (!toText(featurePath)) throw new Error(`${sourceName} feature path is required`)
  if (!fs.existsSync(featurePath)) throw new Error(`${sourceName} feature path not found: ${featurePath}`)
  const lookup = new Map()
  let seenRows = 0
  let acceptedRows = 0
  await iterateJsonlMaybeGzip(featurePath, {
    strict: true,
    onRow: async (row, context) => {
      seenRows += 1
      assertNoForbiddenFieldNames({
        value: row?.features ?? {},
        contract,
        sourceLabel: `${sourceName} features ${context.filePath}:${context.lineNumber}`,
        keyPath: ["features"],
      })
      if (toText(row?.gateId) !== gateId) return
      acceptedRows += 1
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = requireDateKey(row?.decisionDateKey, `${sourceName} decisionDateKey`)
      const featureCutoffDateKey = requireDateKey(row?.featureCutoffDateKey, `${sourceName} featureCutoffDateKey`)
      if (!symbol) throw new Error(`${sourceName} row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (featureCutoffDateKey !== decisionDateKey) {
        throw new Error(
          `${sourceName} row must be D0-close only for ${decisionDateKey}::${symbol}; featureCutoffDateKey=${featureCutoffDateKey}`,
        )
      }
      if (!isObject(row?.features)) throw new Error(`${sourceName} row missing features object for ${decisionDateKey}::${symbol}`)
      for (const field of requiredFeatureFields) {
        requireFinite(row.features[field], `${sourceName} ${decisionDateKey}::${symbol} features.${field}`)
      }
      const key = keyOf(symbol, decisionDateKey)
      if (lookup.has(key)) throw new Error(`duplicate ${sourceName} D0 row for ${decisionDateKey}::${symbol}`)
      lookup.set(key, row)
    },
  })
  if (acceptedRows < 1) throw new Error(`${sourceName} loaded zero rows for gateId=${gateId}`)
  return { lookup, seenRows, acceptedRows }
}

const assertRequiredTopLevelFields = ({ row, fields, label }) => {
  for (const field of fields) requireFinite(row?.[field], `${label}.${field}`)
}

const buildSelectorFeatureAliases = ({ baseRow, sideRow, intradayRow, contract, sourceLabel }) => {
  assertRequiredTopLevelFields({
    row: baseRow,
    fields: Array.isArray(contract.requiredBaseFields) ? contract.requiredBaseFields : [],
    label: `${sourceLabel} base`,
  })
  const sideFeatures = sideRow.features
  const intradayFeatures = intradayRow.features
  return {
    d0ClosePressurePct: requireFinite(baseRow.openToCloseReturn, `${sourceLabel}.openToCloseReturn`),
    d0TradingValue: requireFinite(baseRow.tradedValue, `${sourceLabel}.tradedValue`),
    d0TradingValueRel20: requireFinite(baseRow.tradedValueRel20, `${sourceLabel}.tradedValueRel20`),
    d0CloseLocation: requireFinite(baseRow.closeLocation, `${sourceLabel}.closeLocation`),
    d0RangePct: requireFinite(baseRow.rangePct, `${sourceLabel}.rangePct`),
    d0SideDailyAlignment: requireFinite(
      sideFeatures.side_alignment_investor_program_d0_sign,
      `${sourceLabel}.side_alignment_investor_program_d0_sign`,
    ),
    d0SideDailyPressure: requireFinite(
      sideFeatures.side_pressure_investor_program_d0_signed_log1p,
      `${sourceLabel}.side_pressure_investor_program_d0_signed_log1p`,
    ),
    d0IntradayCloseStrength: requireFinite(intradayFeatures.d0_close_strength, `${sourceLabel}.d0_close_strength`),
    d0IntradayVwapHoldRatio: requireFinite(intradayFeatures.d0_vwap_hold_ratio, `${sourceLabel}.d0_vwap_hold_ratio`),
    d0IntradayCloseBreakoutStrength: requireFinite(
      intradayFeatures.d0_close_strength_after_breakout,
      `${sourceLabel}.d0_close_strength_after_breakout`,
    ),
  }
}

const prefixedFeatureMap = (prefix, features, sourceLabel) => {
  const output = {}
  for (const [field, value] of Object.entries(features ?? {})) {
    output[`${prefix}.${field}`] = requireFinite(value, `${sourceLabel}.${field}`)
  }
  return output
}

export const buildTp12SelectorFeatureSourceRepairRows = async ({
  baseFeaturePath,
  sideFeaturePath,
  intradayFeaturePath,
  outPath,
  summaryPath,
  contractPath = DEFAULT_SELECTOR_FEATURE_SOURCE_CONTRACT_PATH,
  gateId = DEFAULT_GATE_ID,
} = {}) => {
  if (!toText(baseFeaturePath)) throw new Error("baseFeaturePath is required")
  if (!fs.existsSync(baseFeaturePath)) throw new Error(`base feature path not found: ${baseFeaturePath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(summaryPath)) throw new Error("summaryPath is required")
  const contract = await readContract(contractPath)
  const requiredSide = Array.isArray(contract.requiredSideFeatureFields) ? contract.requiredSideFeatureFields : []
  const requiredIntraday = Array.isArray(contract.requiredIntradayFeatureFields) ? contract.requiredIntradayFeatureFields : []
  const side = await loadGateFeatureLookup({
    featurePath: sideFeaturePath,
    gateId,
    contract,
    sourceName: "side-daily",
    requiredFeatureFields: requiredSide,
  })
  const intraday = await loadGateFeatureLookup({
    featurePath: intradayFeaturePath,
    gateId,
    contract,
    sourceName: "intraday",
    requiredFeatureFields: requiredIntraday,
  })

  await ensureDir(path.dirname(outPath))
  const writer = fs.createWriteStream(outPath, { encoding: "utf8" })
  let baseRowCount = 0
  let outputRowCount = 0
  let hitRows = 0
  const matchedSideKeys = new Set()
  const matchedIntradayKeys = new Set()
  const decisionDateKeys = new Set()
  const outputFeatureNames = new Set()
  const seenBaseKeys = new Set()
  try {
    await iterateJsonlMaybeGzip(baseFeaturePath, {
      strict: true,
      onRow: async (row, context) => {
        baseRowCount += 1
        assertNoForbiddenFieldNames({
          value: row,
          contract,
          sourceLabel: `base ${context.filePath}:${context.lineNumber}`,
        })
        const symbol = toText(row?.symbol).toUpperCase()
        const decisionDateKey = requireDateKey(row?.decisionDateKey ?? row?.dateKey, "base decisionDateKey")
        if (!symbol) throw new Error(`base row missing symbol at ${context.filePath}:${context.lineNumber}`)
        const key = keyOf(symbol, decisionDateKey)
        if (seenBaseKeys.has(key)) throw new Error(`duplicate base selector feature row: ${decisionDateKey}::${symbol}`)
        seenBaseKeys.add(key)
        const sideRow = side.lookup.get(key)
        if (!sideRow) throw new Error(`missing side-daily D0 coverage for selector row ${decisionDateKey}::${symbol}`)
        const intradayRow = intraday.lookup.get(key)
        if (!intradayRow) throw new Error(`missing intraday D0-close coverage for selector row ${decisionDateKey}::${symbol}`)
        const sourceLabel = `${decisionDateKey}::${symbol}`
        const aliases = buildSelectorFeatureAliases({ baseRow: row, sideRow, intradayRow, contract, sourceLabel })
        const output = {
          ...row,
          ...aliases,
          selectorFeatureSourceRepair: {
            kind: TP12_SELECTOR_FEATURE_SOURCE_REPAIR_KIND,
            patchKey: "tp12_selector_feature_source_repair_v1",
            gateId,
            sourceAsOf: "D0_CLOSE_ONLY",
            sideDailyFeatureCutoffDateKey: requireDateKey(sideRow.featureCutoffDateKey, "sideDaily featureCutoffDateKey"),
            intradayFeatureCutoffDateKey: requireDateKey(intradayRow.featureCutoffDateKey, "intraday featureCutoffDateKey"),
            intradayFeatureCutoffTsKst: toText(intradayRow.featureCutoffTsKst),
          },
          selectorFeatureVec: {
            ...aliases,
            ...prefixedFeatureMap("side", sideRow.features, `${sourceLabel}.side`),
            ...prefixedFeatureMap("intraday", intradayRow.features, `${sourceLabel}.intraday`),
          },
        }
        assertNoForbiddenFieldNames({ value: output, contract, sourceLabel: `output ${sourceLabel}` })
        assertRequiredTopLevelFields({
          row: output,
          fields: Array.isArray(contract.requiredSelectorFeatureFields) ? contract.requiredSelectorFeatureFields : [],
          label: `output ${sourceLabel}`,
        })
        for (const field of Object.keys(aliases)) outputFeatureNames.add(field)
        if (output.hitTarget === true || output.operationalHitTarget === true) hitRows += 1
        decisionDateKeys.add(decisionDateKey)
        matchedSideKeys.add(key)
        matchedIntradayKeys.add(key)
        outputRowCount += 1
        await writeJsonlRow(writer, output)
      },
    })
  } finally {
    await closeWriteStream(writer)
  }
  if (outputRowCount < 1) throw new Error(`selector feature source repair produced zero rows from ${baseFeaturePath}`)
  for (const key of side.lookup.keys()) {
    if (!matchedSideKeys.has(key)) throw new Error(`side-daily D0 row has no matching base selector row: ${key}`)
  }
  for (const key of intraday.lookup.keys()) {
    if (!matchedIntradayKeys.has(key)) throw new Error(`intraday D0 row has no matching base selector row: ${key}`)
  }
  const summary = {
    kind: "tp12_selector_feature_source_repair_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    patchKey: "tp12_selector_feature_source_repair_v1",
    contractPath: path.resolve(contractPath),
    baseFeaturePath: path.resolve(baseFeaturePath),
    sideFeaturePath: path.resolve(sideFeaturePath),
    intradayFeaturePath: path.resolve(intradayFeaturePath),
    outPath: path.resolve(outPath),
    gateId,
    sourceAsOf: "D0_CLOSE_ONLY",
    baseRowCount,
    outputRowCount,
    hitRows,
    decisionDateCount: decisionDateKeys.size,
    sideDailyRowsSeen: side.seenRows,
    sideDailyRowsAccepted: side.acceptedRows,
    intradayRowsSeen: intraday.seenRows,
    intradayRowsAccepted: intraday.acceptedRows,
    outputFeatureNames: uniqueSorted([...outputFeatureNames]),
    coverage: {
      status: "full_match",
      sideDailyMatchedRows: matchedSideKeys.size,
      intradayMatchedRows: matchedIntradayKeys.size,
    },
  }
  await writeJson(summaryPath, summary)
  return summary
}

export const assertTp12SelectorFeatureSourceRows = async ({
  rowPath,
  contractPath = DEFAULT_SELECTOR_FEATURE_SOURCE_CONTRACT_PATH,
} = {}) => {
  if (!toText(rowPath)) throw new Error("rowPath is required")
  if (!fs.existsSync(rowPath)) throw new Error(`rowPath not found: ${rowPath}`)
  const contract = await readContract(contractPath)
  let rowCount = 0
  await iterateJsonlMaybeGzip(rowPath, {
    strict: true,
    onRow: async (row, context) => {
      rowCount += 1
      assertNoForbiddenFieldNames({
        value: row,
        contract,
        sourceLabel: `${context.filePath}:${context.lineNumber}`,
      })
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = requireDateKey(row?.decisionDateKey ?? row?.dateKey, "selector decisionDateKey")
      if (!symbol) throw new Error(`selector row missing symbol at ${context.filePath}:${context.lineNumber}`)
      assertRequiredTopLevelFields({
        row,
        fields: Array.isArray(contract.requiredSelectorFeatureFields) ? contract.requiredSelectorFeatureFields : [],
        label: `${decisionDateKey}::${symbol}`,
      })
    },
  })
  if (rowCount < 1) throw new Error(`selector feature source row file is empty: ${rowPath}`)
  return {
    status: "passed",
    kind: "tp12_selector_feature_source_repair_assertion_v1",
    rowPath: path.resolve(rowPath),
    rowCount,
  }
}
