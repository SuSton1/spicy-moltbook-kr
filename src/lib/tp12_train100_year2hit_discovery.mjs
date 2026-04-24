import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import zlib from "node:zlib"

import { ensureDir, readJson, writeJson, writeJsonAtomic } from "./io.mjs"
import {
  closeWriteStream,
  createJsonlWriteStreamMaybeGzip,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const DEFAULT_CORE_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const DEFAULT_NUMERIC_ATOM_SPECS = {
  gapPct: [-0.08, -0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05, 0.08, 0.12],
  openToCloseReturn: [-0.08, -0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05, 0.08, 0.12],
  return1d: [-0.08, -0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05, 0.08, 0.12],
  return3d: [-0.12, -0.08, -0.05, -0.02, 0, 0.03, 0.06, 0.1, 0.18, 0.3],
  return5d: [-0.18, -0.12, -0.08, -0.03, 0, 0.05, 0.1, 0.18, 0.3, 0.5],
  return10d: [-0.25, -0.15, -0.08, -0.03, 0, 0.08, 0.15, 0.25, 0.45, 0.8],
  return20d: [-0.35, -0.2, -0.1, -0.03, 0, 0.1, 0.25, 0.45, 0.8, 1.2],
  rangePct: [0.03, 0.05, 0.08, 0.12, 0.18, 0.25],
  rangeRel20: [-0.5, -0.25, 0, 0.5, 1, 2],
  closeLocation: [0.1, 0.25, 0.5, 0.75, 0.9],
  closeOverMa5: [-0.1, -0.05, -0.02, 0, 0.03, 0.08, 0.15, 0.3],
  closeOverMa20: [-0.15, -0.08, -0.03, 0, 0.05, 0.12, 0.25, 0.5],
  closeOverMa60: [-0.2, -0.1, -0.03, 0, 0.08, 0.2, 0.4, 0.8],
  tradedValueRel20: [-0.75, -0.5, -0.25, 0, 0.5, 1, 2, 4, 9],
  tradedValueRel60: [-0.75, -0.5, -0.25, 0, 0.5, 1, 2, 4, 9],
  tradedValueRankPct: [0.01, 0.03, 0.05, 0.1, 0.2, 0.4, 0.7],
  returnVol20: [0.02, 0.04, 0.06, 0.1, 0.15],
  closeToHigh20Pct: [-0.5, -0.3, -0.2, -0.1, -0.05, -0.02, 0],
  closeFromLow20Pct: [0, 0.05, 0.1, 0.2, 0.4, 0.8],
  marketUpRatio: [0.3, 0.4, 0.5, 0.6, 0.7],
  marketUpRatio5: [0.3, 0.4, 0.5, 0.6, 0.7],
  marketUpRatio20: [0.3, 0.4, 0.5, 0.6, 0.7],
  marketMedianReturn1d: [-0.03, -0.015, 0, 0.015, 0.03],
  marketMedianReturn5: [-0.03, -0.015, 0, 0.015, 0.03],
  marketMedianReturn20: [-0.03, -0.015, 0, 0.015, 0.03],
  marketMeanReturn1d: [-0.03, -0.015, 0, 0.015, 0.03],
  marketMeanReturn5: [-0.03, -0.015, 0, 0.015, 0.03],
  marketMeanReturn20: [-0.03, -0.015, 0, 0.015, 0.03],
  limitUpProxyCount: [1, 3, 5, 10, 20, 40],
  limitUpProxyAvg5: [1, 3, 5, 10, 20, 40],
  limitUpProxyAvg20: [1, 3, 5, 10, 20, 40],
  limitUpProxyRel20: [-0.75, -0.5, 0, 0.5, 1, 2, 4],
}

const sha256 = (text) => crypto.createHash("sha256").update(String(text ?? "")).digest("hex")
const sha256Buffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex")
const stableId = (prefix, values) => `${prefix}_${sha256(values.join("\n")).slice(0, 16)}`
const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const rowDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey)
const supportKeyOf = (symbol, decisionDateKey) => `${symbol}\t${decisionDateKey}`
const yearOf = (dateKey) => Number(toText(dateKey).slice(0, 4))
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const maybeResolve = (filePath) => (toText(filePath) ? path.resolve(filePath) : null)

const pathLooksLikeOos = (filePath) => {
  const text = toText(filePath).toLowerCase()
  if (!text) return false
  return /(^|[/_.-])oos([/_.-]|$)/.test(text) || /2025|2026/.test(text)
}

const assertNoOosPath = (filePath, label) => {
  if (pathLooksLikeOos(filePath)) {
    throw new Error(`${label} appears to reference OOS data, which is forbidden for train100 discovery: ${filePath}`)
  }
}

export const loadTp12Train100Contract = async (contractPath = "") => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`train100 contract not found: ${contractPath}`)
  return contract
}

const trainRangeFromContract = (contract = {}) => {
  const from = toText(contract?.trainDateRange?.from)
  const to = toText(contract?.trainDateRange?.to)
  if (!validDateKey(from) || !validDateKey(to) || from > to) {
    throw new Error(`invalid trainDateRange in train100 contract: ${from || "missing"}..${to || "missing"}`)
  }
  return { from, to }
}

const coreYearsFromContract = (contract = {}) => {
  const years = Array.isArray(contract?.coreYears) ? contract.coreYears : DEFAULT_CORE_YEARS
  const normalized = [...new Set(years.map((year) => Number(year)).filter((year) => Number.isInteger(year)))].sort(
    (left, right) => left - right,
  )
  if (normalized.length < 1) throw new Error("train100 contract must provide at least one core year")
  return normalized
}

const targetOptionsFromContract = (contract = {}) => {
  const target = contract?.target ?? {}
  return {
    minHitDecisionDatesPerYear: Math.max(1, Math.trunc(toNumber(target.minHitDecisionDatesPerYear, 2))),
    minHitSymbolDatesPerYear: Math.max(1, Math.trunc(toNumber(target.minHitSymbolDatesPerYear, 2))),
    minPositiveSymbolDatesTotal: Math.max(1, Math.trunc(toNumber(target.minPositiveSymbolDatesTotal, 18))),
    requiredTrainPrecision: Math.min(1, Math.max(0, toNumber(target.requiredTrainPrecision, 1))),
    maxFalsePositiveRows: Math.max(0, Math.trunc(toNumber(target.maxFalsePositiveRows, 0))),
  }
}

const miningOptionsFromContract = (contract = {}) => {
  const mining = contract?.mining ?? {}
  return {
    maxPatternAtoms: Math.max(1, Math.trunc(toNumber(mining.maxPatternAtoms, 6))),
    maxEvaluatedCandidates: Math.max(1, Math.trunc(toNumber(mining.maxEvaluatedCandidates, 500000))),
    maxAtomCount: Math.max(1, Math.trunc(toNumber(mining.maxAtomCount, 512))),
    maxSeedAtomMatchRows: Math.max(1, Math.trunc(toNumber(mining.maxSeedAtomMatchRows, 250000))),
    minSeedPositiveSymbolDatesTotal: Math.max(1, Math.trunc(toNumber(mining.minSeedPositiveSymbolDatesTotal, 18))),
    minPositiveDecisionDatesTotal: Math.max(1, Math.trunc(toNumber(mining.minPositiveDecisionDatesTotal, 18))),
    emitRejected: toBool(mining.emitRejected, false),
  }
}

const qualityOptionsFromContract = (contract = {}) => {
  const quality = contract?.qualityGate ?? {}
  return {
    failOnZeroAccepted: toBool(quality.failOnZeroAccepted, false),
    maxTopSymbolShare: Math.min(1, Math.max(0, toNumber(quality.maxTopSymbolShare, 0.2))),
    maxTopDateShare: Math.min(1, Math.max(0, toNumber(quality.maxTopDateShare, 0.15))),
    maxTopYearShare: Math.min(1, Math.max(0, toNumber(quality.maxTopYearShare, 0.2))),
    requireVerificationComplete: toBool(quality.requireVerificationComplete, true),
  }
}

const formatThreshold = (value) => String(value).replace("-", "neg").replace(/\./g, "p")
const safeAtomText = (value) => toText(value).replace(/\s+/g, "_").replace(/[^\w:./=+\-]/g, "_")
const tokenFamily = (token) => safeAtomText(toText(token).split(":")[0] || "unknown")
const tokenPrefix = (token) => {
  const parts = toText(token).split(":")
  if (parts.length <= 1) return tokenFamily(token)
  return safeAtomText(parts.slice(0, 2).join(":"))
}

const numericAtomIds = (field, value, thresholds, { mode = "threshold_and_bucket" } = {}) => {
  if (value === null || value === undefined || value === "") return []
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return []
  const sorted = [...thresholds].map(Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length < 1) return []
  const atoms = []
  for (const threshold of sorted) {
    if (numeric <= threshold) atoms.push(`num:${field}:le:${formatThreshold(threshold)}`)
    if (numeric >= threshold) atoms.push(`num:${field}:ge:${formatThreshold(threshold)}`)
  }
  let bucket = `gt_${formatThreshold(sorted.at(-1))}`
  for (const threshold of sorted) {
    if (numeric <= threshold) {
      bucket = `le_${formatThreshold(threshold)}`
      break
    }
  }
  atoms.push(`num:${field}:bucket:${bucket}`)
  if (mode === "bucket_only") return [`num:${field}:bucket:${bucket}`]
  if (mode === "threshold_only") return atoms.filter((atomId) => !atomId.includes(":bucket:"))
  return atoms
}

const contextKey = (symbol, decisionDateKey) => `${symbol}\t${decisionDateKey}`

async function* jsonlRows(filePath) {
  const sourcePath = toText(filePath)
  if (!sourcePath) throw new Error("JSONL input path is required")
  const source = fs.createReadStream(sourcePath)
  const input = sourcePath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of rl) {
      lineNumber += 1
      const text = String(line ?? "")
      if (!text.trim()) continue
      let row = null
      try {
        row = JSON.parse(text)
      } catch (error) {
        throw new Error(`Malformed JSONL at ${sourcePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`)
      }
      yield { row, context: { lineNumber, filePath: sourcePath } }
    }
  } finally {
    rl.close()
    source.destroy()
    if (input !== source && typeof input.destroy === "function") input.destroy()
  }
}

const sortedSupportKey = (row, context, label) => {
  const symbol = rowSymbol(row)
  const decisionDateKey = rowDateKey(row)
  if (!symbol) throw new Error(`${label} row missing symbol at ${context.filePath}:${context.lineNumber}`)
  if (!validDateKey(decisionDateKey)) {
    throw new Error(`${label} row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
  }
  return { symbol, decisionDateKey, key: contextKey(symbol, decisionDateKey) }
}

const assertSortedSupportKey = (previousKey, key, label, context) => {
  if (previousKey && key <= previousKey) {
    throw new Error(
      `${label} must be strictly sorted by unique symbol/date for stream_sorted_symbol_date join at ${context.filePath}:${context.lineNumber}`,
    )
  }
}

const loadContextRows = async (contextFeaturesPath) => {
  const byKey = new Map()
  if (!toText(contextFeaturesPath)) return byKey
  if (!fs.existsSync(contextFeaturesPath)) throw new Error(`contextFeaturesPath not found: ${contextFeaturesPath}`)
  await iterateJsonlMaybeGzip(contextFeaturesPath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`context row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`context row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      const key = contextKey(symbol, decisionDateKey)
      if (byKey.has(key)) throw new Error(`duplicate context row for ${symbol}/${decisionDateKey}`)
      byKey.set(key, row)
    },
  })
  if (byKey.size < 1) throw new Error(`contextFeaturesPath produced zero rows: ${contextFeaturesPath}`)
  return byKey
}

const requiredNumericFields = (contract = {}) => {
  const atomBuilder = contract?.atomBuilder ?? {}
  return Array.isArray(atomBuilder.requiredNumericFields)
    ? atomBuilder.requiredNumericFields.map(toText).filter(Boolean)
    : []
}

const numericFields = (contract = {}) => {
  const configured = contract?.atomBuilder?.numericFields
  return Array.isArray(configured) && configured.length > 0
    ? configured.map(toText).filter(Boolean)
    : Object.keys(DEFAULT_NUMERIC_ATOM_SPECS)
}

const buildAtomsForRow = ({ row, contextRow, contract }) => {
  const atomBuilder = contract?.atomBuilder ?? {}
  const includeSourceTokens = toBool(atomBuilder.includeSourceTokens, true)
  const includeTokenFamilies = toBool(atomBuilder.includeTokenFamilies, true)
  const includeTokenPrefixAtoms = toBool(atomBuilder.includeTokenPrefixAtoms, true)
  const includeTokenCountAtoms = toBool(atomBuilder.includeTokenCountAtoms, true)
  const tokens = uniqueSorted(Array.isArray(row?.tokens) ? row.tokens : [])
  if (tokens.length < 1) throw new Error(`tokenized event has zero tokens for ${rowSymbol(row)}/${rowDateKey(row)}`)
  const atoms = []
  if (includeSourceTokens) {
    for (const token of tokens) atoms.push(`token:${safeAtomText(token)}`)
  }
  if (includeTokenFamilies) {
    for (const family of uniqueSorted(tokens.map(tokenFamily))) atoms.push(`token_family:${family}`)
  }
  if (includeTokenPrefixAtoms) {
    for (const prefix of uniqueSorted(tokens.map(tokenPrefix))) atoms.push(`token_prefix:${prefix}`)
  }
  if (includeTokenCountAtoms) {
    atoms.push(`token_count:ge:${Math.min(tokens.length, 8)}`)
    if (tokens.length >= 4) atoms.push("token_count:ge:4")
    if (tokens.length >= 8) atoms.push("token_count:ge:8")
  }
  const merged = { ...(contextRow ?? {}), ...row }
  for (const field of requiredNumericFields(contract)) {
    const value = Number(merged[field])
    if (!Number.isFinite(value)) throw new Error(`required numeric atom field missing/non-finite at ${rowSymbol(row)}/${rowDateKey(row)}: ${field}`)
  }
  for (const field of numericFields(contract)) {
    if (!Object.prototype.hasOwnProperty.call(merged, field)) continue
    const fieldModes = contract?.atomBuilder?.numericAtomModesByField ?? {}
    const numericAtomMode = toText(fieldModes[field]) || toText(contract?.atomBuilder?.numericAtomMode) || "threshold_and_bucket"
    atoms.push(...numericAtomIds(field, merged[field], DEFAULT_NUMERIC_ATOM_SPECS[field] ?? [], { mode: numericAtomMode }))
  }
  return uniqueSorted(atoms)
}

export const assertTp12Train100Preflight = async ({
  contractPath,
  tokenizedEventsPath,
  contextFeaturesPath = "",
  entryFeasibilitySummaryPath = "",
  outPath,
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  if (!toText(tokenizedEventsPath)) throw new Error("tokenizedEventsPath is required")
  if (!fs.existsSync(tokenizedEventsPath)) throw new Error(`tokenizedEventsPath not found: ${tokenizedEventsPath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  const preflight = contract?.preflight ?? {}
  if (toBool(preflight.failOnOosPath, true)) {
    assertNoOosPath(tokenizedEventsPath, "tokenizedEventsPath")
    if (toText(contextFeaturesPath)) assertNoOosPath(contextFeaturesPath, "contextFeaturesPath")
    if (toText(entryFeasibilitySummaryPath)) assertNoOosPath(entryFeasibilitySummaryPath, "entryFeasibilitySummaryPath")
  }
  const { from, to } = trainRangeFromContract(contract)
  const failures = []
  const samples = []
  let inputRowCount = 0
  let hitRowCount = 0
  await iterateJsonlMaybeGzip(tokenizedEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`tokenized event missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`tokenized event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (toBool(preflight.failOnRowOutsideTrainRange, true) && (decisionDateKey < from || decisionDateKey > to)) {
        failures.push(`row_outside_train_range:${decisionDateKey}`)
        if (samples.length < 20) samples.push({ symbol, decisionDateKey })
      }
      if (toBool(preflight.requireHitTargetField, true) && !Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`tokenized event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      if (row.hitTarget === true) hitRowCount += 1
      const tokens = uniqueSorted(Array.isArray(row?.tokens) ? row.tokens : [])
      if (tokens.length < 1) throw new Error(`tokenized event missing tokens at ${context.filePath}:${context.lineNumber}`)
    },
  })
  if (inputRowCount < 1) failures.push("zero_tokenized_events")
  const entryRequired = toBool(preflight.requireEntryFeasibilitySummary, toBool(contract?.label?.requireEntryFeasibilitySummary, true))
  let entryFeasibilitySummary = null
  if (entryRequired || toText(entryFeasibilitySummaryPath)) {
    if (!toText(entryFeasibilitySummaryPath)) throw new Error("entryFeasibilitySummaryPath is required by train100 contract")
    entryFeasibilitySummary = await readJson(entryFeasibilitySummaryPath, null)
    if (!entryFeasibilitySummary) throw new Error(`entry feasibility summary not found: ${entryFeasibilitySummaryPath}`)
    if (toBool(preflight.requireEntryFeasibilityStatusPassed, true) && entryFeasibilitySummary.status !== "passed") {
      failures.push(`entry_feasibility_status:${entryFeasibilitySummary.status ?? "missing"}`)
    }
    const invalidRows = toNumber(entryFeasibilitySummary.invalidRowCount, 0)
    if (invalidRows > 0) failures.push(`entry_feasibility_invalid_rows:${invalidRows}`)
  }
  const payload = {
    kind: "tp12_train100_preflight_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    tokenizedEventsPath: path.resolve(tokenizedEventsPath),
    contextFeaturesPath: maybeResolve(contextFeaturesPath),
    entryFeasibilitySummaryPath: maybeResolve(entryFeasibilitySummaryPath),
    trainDateRange: { from, to },
    coreYears: coreYearsFromContract(contract),
    inputRowCount,
    hitRowCount,
    failures,
    samples,
    entryFeasibilityStatus: entryFeasibilitySummary?.status ?? null,
  }
  await writeJson(outPath, payload)
  if (payload.status !== "passed") throw new Error(`tp12 train100 preflight failed: ${failures.join("; ")}`)
  return payload
}

const readNextContextState = async (contextIterator, previousContextKeyRef) => {
  const state = await contextIterator.next()
  if (state.done) return { done: true }
  const support = sortedSupportKey(state.value.row, state.value.context, "context")
  assertSortedSupportKey(previousContextKeyRef.value, support.key, "context features", state.value.context)
  previousContextKeyRef.value = support.key
  return {
    done: false,
    row: state.value.row,
    context: state.value.context,
    support,
  }
}

const buildTp12Train100AtomTableStreamingJoin = async ({
  contract,
  contractPath,
  tokenizedEventsPath,
  contextFeaturesPath,
  outAtomsPath,
  outManifestPath,
  from,
  to,
} = {}) => {
  const atomCounts = new Map()
  const atomHitCounts = new Map()
  await ensureDir(path.dirname(outAtomsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outAtomsPath)
  const contextIterator = jsonlRows(contextFeaturesPath)[Symbol.asyncIterator]()
  const previousContextKeyRef = { value: "" }
  let contextState = await readNextContextState(contextIterator, previousContextKeyRef)
  let previousTokenKey = ""
  let inputRowCount = 0
  let contextRowCount = 0
  let outputRowCount = 0
  let skippedOutsideTrainRowCount = 0
  let hitRowCount = 0
  try {
    for await (const { row, context } of jsonlRows(tokenizedEventsPath)) {
      inputRowCount += 1
      const support = sortedSupportKey(row, context, "tokenized event")
      assertSortedSupportKey(previousTokenKey, support.key, "tokenized events", context)
      previousTokenKey = support.key
      if (contextState.done) throw new Error(`missing context feature row for ${support.symbol}/${support.decisionDateKey}`)
      if (contextState.support.key < support.key) {
        throw new Error(`context feature row has no matching tokenized event before ${support.symbol}/${support.decisionDateKey}: ${contextState.support.key}`)
      }
      if (contextState.support.key > support.key) {
        throw new Error(`missing context feature row for ${support.symbol}/${support.decisionDateKey}`)
      }
      const contextRow = contextState.row
      contextRowCount += 1
      contextState = await readNextContextState(contextIterator, previousContextKeyRef)
      if (support.decisionDateKey < from || support.decisionDateKey > to) {
        skippedOutsideTrainRowCount += 1
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`tokenized event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const atoms = buildAtomsForRow({ row, contextRow, contract })
      const hitTarget = row.hitTarget === true
      for (const atomId of atoms) {
        incrementMap(atomCounts, atomId)
        if (hitTarget) incrementMap(atomHitCounts, atomId)
      }
      if (hitTarget) hitRowCount += 1
      outputRowCount += 1
      await writeJsonlRow(writer.stream, {
        kind: "tp12_train100_atom_event_v1",
        symbol: support.symbol,
        decisionDateKey: support.decisionDateKey,
        supportKey: support.key,
        year: yearOf(support.decisionDateKey),
        hitTarget,
        entryDateKey: validDateKey(row?.entryDateKey) ? row.entryDateKey : null,
        atoms,
      })
    }
    if (!contextState.done) {
      throw new Error(`context feature row has no matching tokenized event after tokenized EOF: ${contextState.support.key}`)
    }
  } finally {
    if (typeof contextIterator.return === "function") await contextIterator.return()
    await writer.close()
  }
  const manifest = {
    kind: "tp12_train100_atom_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    contextJoinMode: "stream_sorted_symbol_date",
    contractPath: path.resolve(contractPath),
    tokenizedEventsPath: path.resolve(tokenizedEventsPath),
    contextFeaturesPath: maybeResolve(contextFeaturesPath),
    outAtomsPath: path.resolve(outAtomsPath),
    trainDateRange: { from, to },
    inputRowCount,
    contextRowCount,
    outputRowCount,
    skippedOutsideTrainRowCount,
    hitRowCount,
    atomCount: atomCounts.size,
    topAtoms: [...atomCounts.entries()]
      .map(([atomId, matchRows]) => ({ atomId, matchRows, hitRows: atomHitCounts.get(atomId) ?? 0 }))
      .sort((left, right) => right.hitRows - left.hitRows || right.matchRows - left.matchRows || left.atomId.localeCompare(right.atomId))
      .slice(0, 100),
  }
  await writeJson(outManifestPath, manifest)
  return manifest
}

export const buildTp12Train100AtomTable = async ({
  contractPath,
  tokenizedEventsPath,
  contextFeaturesPath = "",
  outAtomsPath,
  outManifestPath,
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  const { from, to } = trainRangeFromContract(contract)
  if (!toText(tokenizedEventsPath)) throw new Error("tokenizedEventsPath is required")
  if (!fs.existsSync(tokenizedEventsPath)) throw new Error(`tokenizedEventsPath not found: ${tokenizedEventsPath}`)
  if (!toText(outAtomsPath)) throw new Error("outAtomsPath is required")
  if (!toText(outManifestPath)) throw new Error("outManifestPath is required")
  if (pathLooksLikeOos(tokenizedEventsPath)) assertNoOosPath(tokenizedEventsPath, "tokenizedEventsPath")
  const requireContext = toBool(contract?.atomBuilder?.requireContextFeatures, false)
  if (requireContext && !toText(contextFeaturesPath)) throw new Error("contextFeaturesPath is required by train100 atomBuilder")
  if (toText(contextFeaturesPath)) assertNoOosPath(contextFeaturesPath, "contextFeaturesPath")
  const contextJoinMode = toText(contract?.atomBuilder?.contextJoinMode) || "in_memory_map"
  if (contextJoinMode === "stream_sorted_symbol_date") {
    if (!toText(contextFeaturesPath)) throw new Error("contextFeaturesPath is required for stream_sorted_symbol_date context join")
    if (!fs.existsSync(contextFeaturesPath)) throw new Error(`contextFeaturesPath not found: ${contextFeaturesPath}`)
    return buildTp12Train100AtomTableStreamingJoin({
      contract,
      contractPath,
      tokenizedEventsPath,
      contextFeaturesPath,
      outAtomsPath,
      outManifestPath,
      from,
      to,
    })
  }
  const contextRows = await loadContextRows(contextFeaturesPath)
  const supportKeys = new Set()
  const atomCounts = new Map()
  const atomHitCounts = new Map()
  await ensureDir(path.dirname(outAtomsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outAtomsPath)
  let inputRowCount = 0
  let outputRowCount = 0
  let skippedOutsideTrainRowCount = 0
  let hitRowCount = 0
  try {
    await iterateJsonlMaybeGzip(tokenizedEventsPath, {
      strict: true,
      onRow: async (row, context) => {
        inputRowCount += 1
        const symbol = rowSymbol(row)
        const decisionDateKey = rowDateKey(row)
        if (!symbol) throw new Error(`tokenized event missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`tokenized event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
        }
        if (decisionDateKey < from || decisionDateKey > to) {
          skippedOutsideTrainRowCount += 1
          return
        }
        if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
          throw new Error(`tokenized event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
        }
        const supportKey = supportKeyOf(symbol, decisionDateKey)
        if (supportKeys.has(supportKey)) throw new Error(`duplicate train100 support row for symbol/date: ${symbol}/${decisionDateKey}`)
        supportKeys.add(supportKey)
        const contextRow = contextRows.size > 0 ? contextRows.get(contextKey(symbol, decisionDateKey)) : null
        if (contextRows.size > 0 && !contextRow) {
          throw new Error(`missing context feature row for ${symbol}/${decisionDateKey}`)
        }
        const atoms = buildAtomsForRow({ row, contextRow, contract })
        const hitTarget = row.hitTarget === true
        for (const atomId of atoms) {
          incrementMap(atomCounts, atomId)
          if (hitTarget) incrementMap(atomHitCounts, atomId)
        }
        if (hitTarget) hitRowCount += 1
        outputRowCount += 1
        await writeJsonlRow(writer.stream, {
          kind: "tp12_train100_atom_event_v1",
          symbol,
          decisionDateKey,
          supportKey,
          year: yearOf(decisionDateKey),
          hitTarget,
          entryDateKey: validDateKey(row?.entryDateKey) ? row.entryDateKey : null,
          atoms,
        })
      },
    })
  } finally {
    await writer.close()
  }
  const manifest = {
    kind: "tp12_train100_atom_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    contextJoinMode,
    contractPath: path.resolve(contractPath),
    tokenizedEventsPath: path.resolve(tokenizedEventsPath),
    contextFeaturesPath: maybeResolve(contextFeaturesPath),
    outAtomsPath: path.resolve(outAtomsPath),
    trainDateRange: { from, to },
    inputRowCount,
    outputRowCount,
    skippedOutsideTrainRowCount,
    hitRowCount,
    atomCount: atomCounts.size,
    topAtoms: [...atomCounts.entries()]
      .map(([atomId, matchRows]) => ({ atomId, matchRows, hitRows: atomHitCounts.get(atomId) ?? 0 }))
      .sort((left, right) => right.hitRows - left.hitRows || right.matchRows - left.matchRows || left.atomId.localeCompare(right.atomId))
      .slice(0, 100),
  }
  await writeJson(outManifestPath, manifest)
  return manifest
}

const loadAtomDataset = async ({ atomEventsPath, contract, includeRowAtomBits = false }) => {
  if (!toText(atomEventsPath)) throw new Error("atomEventsPath is required")
  if (!fs.existsSync(atomEventsPath)) throw new Error(`atomEventsPath not found: ${atomEventsPath}`)
  if (pathLooksLikeOos(atomEventsPath)) assertNoOosPath(atomEventsPath, "atomEventsPath")
  const { from, to } = trainRangeFromContract(contract)
  const atomIdByAtom = new Map()
  const atomById = []
  const atomCounts = []
  const dateIdByDateKey = new Map()
  const dateKeys = []
  const symbolIdBySymbol = new Map()
  const symbols = []
  const supportKeys = new Set()
  let rowCount = 0
  await iterateJsonlMaybeGzip(atomEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`atom event missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`atom event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (decisionDateKey < from || decisionDateKey > to) {
        throw new Error(`atom event outside train range at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`atom event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const atoms = uniqueSorted(row?.atoms ?? [])
      if (atoms.length < 1) throw new Error(`atom event has zero atoms at ${context.filePath}:${context.lineNumber}`)
      const supportKey = toText(row?.supportKey) || supportKeyOf(symbol, decisionDateKey)
      if (supportKeys.has(supportKey)) throw new Error(`duplicate atom support key: ${supportKey}`)
      supportKeys.add(supportKey)
      for (const atomId of atoms) {
        let atomIndex = atomIdByAtom.get(atomId)
        if (atomIndex === undefined) {
          atomIndex = atomById.length
          atomIdByAtom.set(atomId, atomIndex)
          atomById.push(atomId)
          atomCounts[atomIndex] = 0
        }
        atomCounts[atomIndex] += 1
      }
      if (!dateIdByDateKey.has(decisionDateKey)) {
        dateIdByDateKey.set(decisionDateKey, dateKeys.length)
        dateKeys.push(decisionDateKey)
      }
      if (!symbolIdBySymbol.has(symbol)) {
        symbolIdBySymbol.set(symbol, symbols.length)
        symbols.push(symbol)
      }
      rowCount += 1
    },
  })
  if (rowCount < 1) throw new Error(`zero atom events: ${atomEventsPath}`)
  const symbolIds = new Uint32Array(rowCount)
  const dateIds = new Uint32Array(rowCount)
  const yearValues = new Uint16Array(rowCount)
  const hitFlags = new Uint8Array(rowCount)
  const postingArrays = atomCounts.map((count) => new Uint32Array(count))
  const postingOffsets = new Uint32Array(atomCounts.length)
  const atomWordCount = Math.ceil(Math.max(1, atomCounts.length) / 32)
  const rowAtomBits = includeRowAtomBits ? new Uint32Array(rowCount * atomWordCount) : null
  supportKeys.clear()
  let rowIndex = 0
  await iterateJsonlMaybeGzip(atomEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`atom event missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`atom event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (decisionDateKey < from || decisionDateKey > to) {
        throw new Error(`atom event outside train range at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`atom event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const atoms = uniqueSorted(row?.atoms ?? [])
      if (atoms.length < 1) throw new Error(`atom event has zero atoms at ${context.filePath}:${context.lineNumber}`)
      const supportKey = toText(row?.supportKey) || supportKeyOf(symbol, decisionDateKey)
      if (supportKeys.has(supportKey)) throw new Error(`duplicate atom support key on second pass: ${supportKey}`)
      supportKeys.add(supportKey)
      symbolIds[rowIndex] = symbolIdBySymbol.get(symbol)
      dateIds[rowIndex] = dateIdByDateKey.get(decisionDateKey)
      yearValues[rowIndex] = yearOf(decisionDateKey)
      hitFlags[rowIndex] = row.hitTarget === true ? 1 : 0
      for (const atomId of atoms) {
        const atomIndex = atomIdByAtom.get(atomId)
        if (atomIndex === undefined) throw new Error(`atom disappeared between passes: ${atomId}`)
        postingArrays[atomIndex][postingOffsets[atomIndex]] = rowIndex
        postingOffsets[atomIndex] += 1
        if (rowAtomBits) {
          rowAtomBits[rowIndex * atomWordCount + Math.floor(atomIndex / 32)] |= 1 << (atomIndex % 32)
        }
      }
      rowIndex += 1
    },
  })
  if (rowIndex !== rowCount) throw new Error(`atom event two-pass row count mismatch: first=${rowCount} second=${rowIndex}`)
  const rows = {
    length: rowCount,
    symbolIds,
    dateIds,
    yearValues,
    hitFlags,
    symbols,
    dateKeys,
    rowAtomBits,
    atomWordCount,
  }
  const postings = new Map(atomById.map((atomId, index) => [atomId, postingArrays[index]]))
  return { rows, postings, atomById, atomIdByAtom }
}

const rowAt = (rows, index) => {
  const symbol = rows.symbols[rows.symbolIds[index]]
  const decisionDateKey = rows.dateKeys[rows.dateIds[index]]
  return {
    symbol,
    decisionDateKey,
    supportKey: supportKeyOf(symbol, decisionDateKey),
    year: rows.yearValues[index],
    hitTarget: rows.hitFlags[index] === 1,
  }
}

const intersectSortedArrays = (left, right) => {
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const a = left[i]
    const b = right[j]
    if (a === b) {
      out.push(a)
      i += 1
      j += 1
    } else if (a < b) {
      i += 1
    } else {
      j += 1
    }
  }
  return Uint32Array.from(out)
}

const supportForAtoms = ({ atomIds, postings }) => {
  const entries = atomIds.map((atomId) => postings.get(atomId)).filter(Boolean)
  if (entries.length !== atomIds.length) return new Uint32Array()
  entries.sort((left, right) => left.length - right.length)
  let support = entries[0]
  for (let index = 1; index < entries.length; index += 1) {
    support = intersectSortedArrays(support, entries[index])
    if (support.length < 1) break
  }
  return support
}

const supportHash = (support) => {
  const buffer = Buffer.from(support.buffer, support.byteOffset, support.byteLength)
  return `${support.length}:${sha256Buffer(buffer)}`
}

const mapFromObject = (value = {}) => new Map(Object.entries(value ?? {}).map(([key, count]) => [key, Number(count) || 0]))

const rowHasAtomIndex = (rows, rowIndex, atomIndex) => {
  if (!rows.rowAtomBits) throw new Error("row atom bitset was not loaded")
  const offset = rowIndex * rows.atomWordCount + Math.floor(atomIndex / 32)
  return (rows.rowAtomBits[offset] & (1 << (atomIndex % 32))) !== 0
}

const filterSupportByAtomIndex = (rows, support, atomIndex) => {
  const out = []
  for (const rowIndex of support) {
    if (rowHasAtomIndex(rows, rowIndex, atomIndex)) out.push(rowIndex)
  }
  return Uint32Array.from(out)
}

const concentrationShare = (counts, denominator) => {
  if (denominator <= 0 || counts.size < 1) return 0
  return Math.max(...counts.values()) / denominator
}

const candidateMetrics = ({ atomIds, support, rows, target, coreYears, searchStrategy }) => {
  const hitDecisionDatesByYear = new Map(coreYears.map((year) => [String(year), new Set()]))
  const hitSymbolDatesByYear = new Map(coreYears.map((year) => [String(year), new Set()]))
  const symbolCounts = new Map()
  const dateCounts = new Map()
  const yearCounts = new Map()
  const supportSamples = []
  let hitRows = 0
  let falsePositiveRows = 0
  for (const index of support) {
    const row = rowAt(rows, index)
    incrementMap(symbolCounts, row.symbol)
    incrementMap(dateCounts, row.decisionDateKey)
    incrementMap(yearCounts, String(row.year))
    if (supportSamples.length < 50) {
      supportSamples.push({
        symbol: row.symbol,
        decisionDateKey: row.decisionDateKey,
        hitTarget: row.hitTarget,
      })
    }
    if (row.hitTarget) {
      hitRows += 1
      const year = String(row.year)
      if (!hitDecisionDatesByYear.has(year)) hitDecisionDatesByYear.set(year, new Set())
      if (!hitSymbolDatesByYear.has(year)) hitSymbolDatesByYear.set(year, new Set())
      hitDecisionDatesByYear.get(year).add(row.decisionDateKey)
      hitSymbolDatesByYear.get(year).add(row.supportKey)
    } else {
      falsePositiveRows += 1
    }
  }
  const matchRows = support.length
  const trainPrecision = safeRatio(hitRows, matchRows)
  const yearStats = {}
  const rejectReasons = []
  for (const year of coreYears) {
    const key = String(year)
    const hitDecisionDates = hitDecisionDatesByYear.get(key) ?? new Set()
    const hitSymbolDates = hitSymbolDatesByYear.get(key) ?? new Set()
    yearStats[key] = {
      hitDecisionDates: hitDecisionDates.size,
      hitSymbolDates: hitSymbolDates.size,
    }
    if (hitDecisionDates.size < target.minHitDecisionDatesPerYear) rejectReasons.push(`year_${key}_hit_decision_dates_below_min`)
    if (hitSymbolDates.size < target.minHitSymbolDatesPerYear) rejectReasons.push(`year_${key}_hit_symbol_dates_below_min`)
  }
  if (matchRows < 1) rejectReasons.push("zero_support")
  if (hitRows < target.minPositiveSymbolDatesTotal) rejectReasons.push("positive_symbol_dates_below_min_total")
  if (falsePositiveRows > target.maxFalsePositiveRows) rejectReasons.push("false_positive_rows_above_max")
  if (trainPrecision < target.requiredTrainPrecision) rejectReasons.push("train_precision_below_required")
  return {
    kind: "tp12_train100_candidate_v1",
    patternId: stableId("tp12_train100", atomIds),
    searchStrategy,
    atomIds,
    atomCount: atomIds.length,
    matchRows,
    hitRows,
    falsePositiveRows,
    trainPrecision,
    yearStats,
    topSymbolShare: concentrationShare(symbolCounts, matchRows),
    topDateShare: concentrationShare(dateCounts, matchRows),
    topYearShare: concentrationShare(yearCounts, matchRows),
    verificationComplete: true,
    qualityPassed: rejectReasons.length === 0,
    rejectReasons,
    supportSamples,
  }
}

const seedAtoms = ({ rows, postings, target, mining, coreYears }) =>
  [...postings.entries()]
    .map(([atomId, support]) => {
      let hitRows = 0
      let falsePositiveRows = 0
      const yearDates = new Map(coreYears.map((year) => [String(year), new Set()]))
      const hitSymbolDates = new Set()
      for (const index of support) {
        const row = rowAt(rows, index)
        if (row.hitTarget) {
          hitRows += 1
          hitSymbolDates.add(row.supportKey)
          const year = String(row.year)
          if (yearDates.has(year)) yearDates.get(year).add(row.decisionDateKey)
        } else {
          falsePositiveRows += 1
        }
      }
      return {
        atomId,
        matchRows: support.length,
        hitRows,
        falsePositiveRows,
        positiveSymbolDates: hitSymbolDates.size,
        minYearHitDecisionDates: Math.min(...coreYears.map((year) => yearDates.get(String(year)).size)),
      }
    })
    .filter(
      (row) =>
        row.matchRows <= mining.maxSeedAtomMatchRows &&
        row.positiveSymbolDates >= Math.max(target.minPositiveSymbolDatesTotal, mining.minSeedPositiveSymbolDatesTotal) &&
        row.minYearHitDecisionDates >= 1,
    )
    .sort(
      (left, right) =>
        left.falsePositiveRows - right.falsePositiveRows ||
        right.minYearHitDecisionDates - left.minYearHitDecisionDates ||
        right.hitRows - left.hitRows ||
        left.matchRows - right.matchRows ||
        left.atomId.localeCompare(right.atomId),
    )

const completionSeedAtoms = ({ rows, postings, target, coreYears }) =>
  [...postings.entries()]
    .map(([atomId, support]) => {
      let hitRows = 0
      let falsePositiveRows = 0
      const yearDates = new Map(coreYears.map((year) => [String(year), new Set()]))
      const yearSymbolDates = new Map(coreYears.map((year) => [String(year), new Set()]))
      for (const index of support) {
        const row = rowAt(rows, index)
        if (row.hitTarget) {
          hitRows += 1
          const year = String(row.year)
          if (yearDates.has(year)) yearDates.get(year).add(row.decisionDateKey)
          if (yearSymbolDates.has(year)) yearSymbolDates.get(year).add(row.supportKey)
        } else {
          falsePositiveRows += 1
        }
      }
      return {
        atomId,
        matchRows: support.length,
        hitRows,
        falsePositiveRows,
        positiveSymbolDates: [...yearSymbolDates.values()].reduce((sum, values) => sum + values.size, 0),
        minYearHitDecisionDates: Math.min(...coreYears.map((year) => yearDates.get(String(year)).size)),
        minYearHitSymbolDates: Math.min(...coreYears.map((year) => yearSymbolDates.get(String(year)).size)),
      }
    })
    .filter(
      (row) =>
        row.positiveSymbolDates >= target.minPositiveSymbolDatesTotal &&
        row.minYearHitDecisionDates >= target.minHitDecisionDatesPerYear &&
        row.minYearHitSymbolDates >= target.minHitSymbolDatesPerYear,
    )
    .sort(
      (left, right) =>
        left.falsePositiveRows - right.falsePositiveRows ||
        right.minYearHitDecisionDates - left.minYearHitDecisionDates ||
        right.minYearHitSymbolDates - left.minYearHitSymbolDates ||
        right.hitRows - left.hitRows ||
        left.matchRows - right.matchRows ||
        left.atomId.localeCompare(right.atomId),
    )

const candidateKey = (atomIds) => atomIds.join("\u0001")

const supportGateStats = ({ support, rows, target, coreYears }) => {
  const yearDates = new Map(coreYears.map((year) => [String(year), new Set()]))
  const yearSymbolDates = new Map(coreYears.map((year) => [String(year), new Set()]))
  let hitRows = 0
  let falsePositiveRows = 0
  for (const index of support) {
    if (rows.hitFlags[index] !== 1) {
      falsePositiveRows += 1
      continue
    }
    hitRows += 1
    const year = String(rows.yearValues[index])
    if (!yearDates.has(year)) continue
    yearDates.get(year).add(rows.dateIds[index])
    yearSymbolDates.get(year).add(`${rows.symbolIds[index]}\t${rows.dateIds[index]}`)
  }
  const yearStats = {}
  let canMeetYearGate = true
  for (const year of coreYears) {
    const key = String(year)
    const hitDecisionDates = yearDates.get(key).size
    const hitSymbolDates = yearSymbolDates.get(key).size
    yearStats[key] = { hitDecisionDates, hitSymbolDates }
    if (hitDecisionDates < target.minHitDecisionDatesPerYear) canMeetYearGate = false
    if (hitSymbolDates < target.minHitSymbolDatesPerYear) canMeetYearGate = false
  }
  return {
    matchRows: support.length,
    hitRows,
    falsePositiveRows,
    trainPrecision: safeRatio(hitRows, support.length),
    yearStats,
    canMeetYearGate,
  }
}

const canStillMeetYearGate = ({ support, rows, target, coreYears }) =>
  supportGateStats({ support, rows, target, coreYears }).canMeetYearGate

const quickCandidateAssessment = ({ atomIds, support, target, coreYears, gateStats }) => {
  const stats = gateStats ?? { yearStats: {} }
  const rejectReasons = []
  for (const year of coreYears) {
    const yearStat = stats.yearStats[String(year)] ?? {}
    if (toNumber(yearStat.hitDecisionDates, 0) < target.minHitDecisionDatesPerYear) {
      rejectReasons.push(`year_${year}_hit_decision_dates_below_min`)
    }
    if (toNumber(yearStat.hitSymbolDates, 0) < target.minHitSymbolDatesPerYear) {
      rejectReasons.push(`year_${year}_hit_symbol_dates_below_min`)
    }
  }
  if (support.length < 1) rejectReasons.push("zero_support")
  if (stats.hitRows < target.minPositiveSymbolDatesTotal) rejectReasons.push("positive_symbol_dates_below_min_total")
  if (stats.falsePositiveRows > target.maxFalsePositiveRows) rejectReasons.push("false_positive_rows_above_max")
  if (stats.trainPrecision < target.requiredTrainPrecision) rejectReasons.push("train_precision_below_required")
  return {
    kind: "tp12_train100_candidate_v1",
    patternId: stableId("tp12_train100", atomIds),
    atomIds,
    atomCount: atomIds.length,
    matchRows: support.length,
    hitRows: stats.hitRows,
    falsePositiveRows: stats.falsePositiveRows,
    trainPrecision: stats.trainPrecision,
    yearStats: stats.yearStats,
    verificationComplete: true,
    qualityPassed: rejectReasons.length === 0,
    rejectReasons,
  }
}

export const mineTp12Train100ExactCandidates = async ({
  contractPath,
  atomEventsPath,
  outCatalogPath,
  outManifestPath,
  outProgressPath = "",
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  const target = targetOptionsFromContract(contract)
  const mining = miningOptionsFromContract(contract)
  const coreYears = coreYearsFromContract(contract)
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  if (!toText(outManifestPath)) throw new Error("outManifestPath is required")
  const { rows, postings } = await loadAtomDataset({ atomEventsPath, contract })
  const seeds = seedAtoms({ rows, postings, target, mining, coreYears }).slice(0, mining.maxAtomCount)
  if (seeds.length < 1) throw new Error("zero seed atoms after train100 seed prefilter")
  const seedIds = seeds.map((row) => row.atomId)
  await ensureDir(path.dirname(outCatalogPath))
  const stream = fs.createWriteStream(outCatalogPath, { encoding: "utf8" })
  const statusCounts = new Map()
  const acceptedBySize = new Map()
  const rejectedReasonCounts = new Map()
  const seen = new Set()
  let evaluatedCandidateCount = 0
  let emittedCandidateCount = 0
  let acceptedCandidateCount = 0
  let activeSeedIndex = -1
  const progressEveryCandidates = Math.max(1, Math.trunc(toNumber(contract?.mining?.progressEveryCandidates, 5000)))
  const writeProgress = async (phase, extra = {}) => {
    if (!toText(outProgressPath)) return
    await writeJson(outProgressPath, {
      kind: "tp12_train100_exact_mining_progress_v1",
      generatedAt: new Date().toISOString(),
      status: "running",
      phase,
      activeSeedIndex,
      seedAtomCount: seedIds.length,
      evaluatedCandidateCount,
      emittedCandidateCount,
      acceptedCandidateCount,
      ...extra,
    })
  }
  await writeProgress("search_started")
  const evaluate = async ({ atomIds, support, searchStrategy, gateStats }) => {
    const key = candidateKey(atomIds)
    if (seen.has(key)) return
    seen.add(key)
    evaluatedCandidateCount += 1
    if (evaluatedCandidateCount > mining.maxEvaluatedCandidates) {
      throw new Error(`train100 exact search exceeded maxEvaluatedCandidates=${mining.maxEvaluatedCandidates}`)
    }
    const quickRow = quickCandidateAssessment({ atomIds, support, target, coreYears, gateStats })
    const row =
      quickRow.qualityPassed || mining.emitRejected
        ? candidateMetrics({ atomIds, support, rows, target, coreYears, searchStrategy })
        : { ...quickRow, searchStrategy }
    incrementMap(statusCounts, row.qualityPassed ? "accepted_train100" : "rejected")
    for (const reason of row.rejectReasons) incrementMap(rejectedReasonCounts, reason)
    if (row.qualityPassed) {
      incrementMap(acceptedBySize, String(row.atomCount))
      acceptedCandidateCount += 1
    }
    if (row.qualityPassed || mining.emitRejected) {
      await writeJsonlRow(stream, row)
      emittedCandidateCount += 1
    }
    if (evaluatedCandidateCount % progressEveryCandidates === 0) {
      await writeProgress("searching", { activeAtomIds: atomIds })
    }
  }
  const dfs = async ({ startIndex, atomIds, support }) => {
    const gateStats = supportGateStats({ support, rows, target, coreYears })
    if (!gateStats.canMeetYearGate) return
    await evaluate({ atomIds, support, searchStrategy: "exact_zero_negative_dfs", gateStats })
    if (atomIds.length >= mining.maxPatternAtoms) return
    for (let index = startIndex; index < seedIds.length; index += 1) {
      const atomId = seedIds[index]
      const nextSupport = intersectSortedArrays(support, postings.get(atomId))
      if (nextSupport.length === support.length) continue
      if (nextSupport.length < target.minPositiveSymbolDatesTotal) continue
      await dfs({
        startIndex: index + 1,
        atomIds: [...atomIds, atomId],
        support: nextSupport,
      })
    }
  }
  let failure = null
  try {
    for (let index = 0; index < seedIds.length; index += 1) {
      activeSeedIndex = index
      await writeProgress("seed_started", { activeSeedAtomId: seedIds[index] })
      const atomId = seedIds[index]
      await dfs({ startIndex: index + 1, atomIds: [atomId], support: postings.get(atomId) })
      await writeProgress("seed_completed", { activeSeedAtomId: seedIds[index] })
    }
  } catch (error) {
    failure = error instanceof Error ? { message: error.message, stack: error.stack ?? "" } : { message: String(error), stack: "" }
  } finally {
    await closeWriteStream(stream)
  }
  const manifest = {
    kind: "tp12_train100_exact_mining_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: failure ? "failed" : "passed",
    searchComplete: !failure,
    contractPath: path.resolve(contractPath),
    atomEventsPath: path.resolve(atomEventsPath),
    outCatalogPath: path.resolve(outCatalogPath),
    outProgressPath: maybeResolve(outProgressPath),
    trainEventCount: rows.length,
    atomCount: postings.size,
    seedAtomCount: seedIds.length,
    evaluatedCandidateCount,
    emittedCandidateCount,
    acceptedCandidateCount,
    acceptedBySize: mapToSortedObject(acceptedBySize),
    statusCounts: mapToSortedObject(statusCounts),
    rejectedReasonCounts: mapToSortedObject(rejectedReasonCounts),
    options: { target, mining, coreYears },
    topSeedAtoms: seeds.slice(0, 100),
    failure,
  }
  await writeJson(outManifestPath, manifest)
  if (toText(outProgressPath)) {
    await writeJson(outProgressPath, {
      kind: "tp12_train100_exact_mining_progress_v1",
      generatedAt: new Date().toISOString(),
      status: manifest.status,
      phase: failure ? "failed" : "completed",
      evaluatedCandidateCount,
      emittedCandidateCount,
      acceptedCandidateCount,
      failure,
    })
  }
  if (failure) throw new Error(`tp12 train100 exact mining failed: ${failure.message}`)
  return manifest
}

const rankCounterexampleBranches = (left, right) =>
  left.stats.falsePositiveRows - right.stats.falsePositiveRows ||
  right.removedNegatives - left.removedNegatives ||
  left.removedPositives - right.removedPositives ||
  right.stats.hitRows - left.stats.hitRows ||
  left.nextSupport.length - right.nextSupport.length ||
  left.atomId.localeCompare(right.atomId)

const buildCounterexampleBranches = ({
  support,
  atomIds,
  counterexampleRowIndex,
  rows,
  postings,
  atomById,
  target,
  coreYears,
  currentStats,
}) => {
  const existingAtomIds = new Set(atomIds)
  const branches = []
  for (let atomIndex = 0; atomIndex < atomById.length; atomIndex += 1) {
    if (rowHasAtomIndex(rows, counterexampleRowIndex, atomIndex)) continue
    const atomId = atomById[atomIndex]
    if (existingAtomIds.has(atomId)) continue
    if (!postings.has(atomId)) continue
    const nextSupport = filterSupportByAtomIndex(rows, support, atomIndex)
    if (nextSupport.length < target.minPositiveSymbolDatesTotal) continue
    const stats = supportGateStats({ support: nextSupport, rows, target, coreYears })
    if (!stats.canMeetYearGate) continue
    if (stats.hitRows < target.minPositiveSymbolDatesTotal) continue
    if (stats.falsePositiveRows >= currentStats.falsePositiveRows) continue
    branches.push({
      atomId,
      nextSupport,
      stats,
      removedNegatives: currentStats.falsePositiveRows - stats.falsePositiveRows,
      removedPositives: currentStats.hitRows - stats.hitRows,
    })
  }
  branches.sort(rankCounterexampleBranches)
  return branches
}

const chooseCounterexampleBranches = ({
  support,
  atomIds,
  rows,
  postings,
  atomById,
  target,
  coreYears,
  currentStats,
  maxCounterexampleScan,
}) => {
  let scannedCounterexampleRows = 0
  let best = null
  for (const rowIndex of support) {
    if (rows.hitFlags[rowIndex] === 1) continue
    scannedCounterexampleRows += 1
    const branches = buildCounterexampleBranches({
      support,
      atomIds,
      counterexampleRowIndex: rowIndex,
      rows,
      postings,
      atomById,
      target,
      coreYears,
      currentStats,
    })
    const candidate = {
      counterexampleRowIndex: rowIndex,
      counterexample: rowAt(rows, rowIndex),
      branches,
      scannedCounterexampleRows,
    }
    if (!best || branches.length < best.branches.length || branches[0]?.stats?.falsePositiveRows < best.branches[0]?.stats?.falsePositiveRows) {
      best = candidate
    }
    if (branches.length < 1) return candidate
    if (scannedCounterexampleRows >= maxCounterexampleScan) break
  }
  return best
}

const checkpointSidecarPath = (checkpointPath, suffix, checkpointId = "") => {
  const text = toText(checkpointPath)
  if (!text) return ""
  const id = toText(checkpointId)
  if (id) return `${text}.${id}.${suffix}.jsonl.gz`
  return `${text}.${suffix}.jsonl.gz`
}

const canonicalJson = (value) => JSON.stringify(value ?? null)

const frontierPartitionBucket = (supportHashValue, partitionCount) => {
  const count = Math.max(1, Math.trunc(toNumber(partitionCount, 1)))
  const supportHashText = toText(supportHashValue)
  const hex = /^[0-9a-f]+$/i.test(supportHashText) ? supportHashText.slice(0, 15) : sha256(supportHashText).slice(0, 15)
  return Number(BigInt(`0x${hex || "0"}`) % BigInt(count))
}

const assertResumeCompatibleContracts = async ({ checkpoint, contractPath } = {}) => {
  const expectedContractPath = path.resolve(contractPath)
  const checkpointContractPath = path.resolve(checkpoint.contractPath)
  if (checkpointContractPath === expectedContractPath) return

  const [checkpointContract, currentContract] = await Promise.all([readJson(checkpointContractPath), readJson(expectedContractPath)])
  const comparablePaths = [
    "kind",
    "trainDateRange",
    "forbiddenDateRange",
    "coreYears",
    "target",
    "label",
    "preflight",
    "atomBuilder",
    "mining",
    "qualityGate",
    "hardStops",
  ]
  const mismatches = []
  for (const key of comparablePaths) {
    if (canonicalJson(checkpointContract?.[key]) !== canonicalJson(currentContract?.[key])) mismatches.push(key)
  }
  const checkpointCounterexample = checkpointContract?.counterexampleExactCompletion ?? {}
  const currentCounterexample = currentContract?.counterexampleExactCompletion ?? {}
  for (const key of ["maxSeeds", "maxCounterexampleScan", "allowIncomplete"]) {
    if (canonicalJson(checkpointCounterexample?.[key]) !== canonicalJson(currentCounterexample?.[key])) {
      mismatches.push(`counterexampleExactCompletion.${key}`)
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `resume checkpoint contractPath mismatch and contracts are not resume-compatible: checkpoint=${checkpoint.contractPath} current=${expectedContractPath} mismatches=${mismatches.join(",")}`,
    )
  }
}

const writeCounterexampleCheckpoint = async ({
  checkpointPath,
  contractPath,
  atomEventsPath,
  frontier,
  seenSupport,
  seenSupportDelta,
  baseCheckpointPath = "",
  statusCounts,
  rejectedReasonCounts,
  deadEndReasonCounts,
  counters,
  options,
} = {}) => {
  if (!toText(checkpointPath)) return null
  await ensureDir(path.dirname(checkpointPath))
  const checkpointId = `ckpt-${Math.trunc(toNumber(counters?.visitedStateCount, 0))}-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
  const seenSupportPath = checkpointSidecarPath(checkpointPath, "seen_support", checkpointId)
  const frontierPath = checkpointSidecarPath(checkpointPath, "frontier", checkpointId)
  const resolvedBaseCheckpointPath = toText(baseCheckpointPath) ? path.resolve(baseCheckpointPath) : ""
  const seenSupportMode = resolvedBaseCheckpointPath ? "delta_from_base_v1" : "full_v1"
  const seenSupportRows = resolvedBaseCheckpointPath ? seenSupportDelta ?? new Set() : seenSupport
  const seenWriter = createJsonlWriteStreamMaybeGzip(seenSupportPath)
  try {
    for (const supportHashValue of seenSupportRows) {
      await writeJsonlRow(seenWriter.stream, { supportHash: supportHashValue })
    }
  } finally {
    await seenWriter.close()
  }
  const frontierWriter = createJsonlWriteStreamMaybeGzip(frontierPath)
  try {
    for (const state of frontier) {
      await writeJsonlRow(frontierWriter.stream, {
        atomIds: state.atomIds,
        supportHash: state.supportHash,
      })
    }
  } finally {
    await frontierWriter.close()
  }
  const checkpoint = {
    kind: "tp12_train100_counterexample_exact_completion_checkpoint_v1",
    generatedAt: new Date().toISOString(),
    status: "checkpoint",
    checkpointId,
    contractPath: path.resolve(contractPath),
    atomEventsPath: path.resolve(atomEventsPath),
    seenSupportMode,
    baseCheckpointPath: resolvedBaseCheckpointPath || null,
    seenSupportPath: path.resolve(seenSupportPath),
    frontierPath: path.resolve(frontierPath),
    seenSupportCount: seenSupport.size,
    seenSupportDeltaCount: seenSupportRows.size,
    frontierSize: frontier.length,
    counters: { ...(counters ?? {}) },
    statusCounts: mapToSortedObject(statusCounts),
    rejectedReasonCounts: mapToSortedObject(rejectedReasonCounts),
    deadEndReasonCounts: mapToSortedObject(deadEndReasonCounts),
    options: { ...(options ?? {}) },
  }
  await writeJsonAtomic(checkpointPath, checkpoint)
  return checkpoint
}

const readCounterexampleCheckpoint = async (checkpointPath) => {
  if (!fs.existsSync(checkpointPath)) throw new Error(`resume checkpoint not found: ${checkpointPath}`)
  const checkpoint = await readJson(checkpointPath)
  if (checkpoint?.kind !== "tp12_train100_counterexample_exact_completion_checkpoint_v1") {
    throw new Error(`invalid counterexample checkpoint kind: ${checkpoint?.kind ?? "missing"}`)
  }
  return checkpoint
}

const loadCounterexampleCheckpointSeenSupport = async ({
  checkpoint,
  checkpointPath,
  contractPath,
  atomEventsPath,
  seenSupport = new Set(),
  depth = 0,
} = {}) => {
  if (depth > 16) throw new Error(`counterexample checkpoint base chain is too deep near ${checkpointPath}`)
  const expectedAtomEventsPath = path.resolve(atomEventsPath)
  await assertResumeCompatibleContracts({ checkpoint, contractPath })
  if (path.resolve(checkpoint.atomEventsPath) !== expectedAtomEventsPath) {
    throw new Error(`resume checkpoint atomEventsPath mismatch: checkpoint=${checkpoint.atomEventsPath} current=${expectedAtomEventsPath}`)
  }
  if (toText(checkpoint.baseCheckpointPath)) {
    const baseCheckpointPath = path.resolve(checkpoint.baseCheckpointPath)
    const baseCheckpoint = await readCounterexampleCheckpoint(baseCheckpointPath)
    await loadCounterexampleCheckpointSeenSupport({
      checkpoint: baseCheckpoint,
      checkpointPath: baseCheckpointPath,
      contractPath,
      atomEventsPath,
      seenSupport,
      depth: depth + 1,
    })
  }
  const beforeCount = seenSupport.size
  let sidecarCount = 0
  if (!toText(checkpoint.seenSupportPath)) throw new Error(`checkpoint missing seenSupportPath: ${checkpointPath}`)
  await iterateJsonlMaybeGzip(checkpoint.seenSupportPath, {
    strict: true,
    onRow: async (row, context) => {
      const supportHashValue = toText(row?.supportHash)
      if (!supportHashValue) throw new Error(`checkpoint seen support missing supportHash at ${context.filePath}:${context.lineNumber}`)
      seenSupport.add(supportHashValue)
      sidecarCount += 1
    },
  })
  if (sidecarCount !== Number(checkpoint.seenSupportDeltaCount ?? sidecarCount)) {
    throw new Error(
      `checkpoint seenSupportDeltaCount mismatch: expected=${checkpoint.seenSupportDeltaCount} actual=${sidecarCount} checkpoint=${checkpointPath}`,
    )
  }
  if (seenSupport.size < beforeCount) {
    throw new Error(`checkpoint seen support shrank while loading base chain: ${checkpointPath}`)
  }
  if (seenSupport.size !== Number(checkpoint.seenSupportCount ?? seenSupport.size)) {
    throw new Error(`checkpoint seenSupportCount mismatch: expected=${checkpoint.seenSupportCount} actual=${seenSupport.size}`)
  }
  return seenSupport
}

const loadCounterexampleCheckpoint = async ({ checkpointPath, contractPath, atomEventsPath, postings } = {}) => {
  if (!toText(checkpointPath)) return null
  const checkpoint = await readCounterexampleCheckpoint(checkpointPath)
  const expectedAtomEventsPath = path.resolve(atomEventsPath)
  await assertResumeCompatibleContracts({ checkpoint, contractPath })
  if (path.resolve(checkpoint.atomEventsPath) !== expectedAtomEventsPath) {
    throw new Error(`resume checkpoint atomEventsPath mismatch: checkpoint=${checkpoint.atomEventsPath} current=${expectedAtomEventsPath}`)
  }
  const seenSupport = await loadCounterexampleCheckpointSeenSupport({
    checkpoint,
    checkpointPath: path.resolve(checkpointPath),
    contractPath,
    atomEventsPath,
  })
  const frontier = []
  await iterateJsonlMaybeGzip(checkpoint.frontierPath, {
    strict: true,
    onRow: async (row, context) => {
      const atomIds = uniqueSorted(row?.atomIds ?? [])
      if (atomIds.length < 1) throw new Error(`checkpoint frontier row missing atomIds at ${context.filePath}:${context.lineNumber}`)
      const support = supportForAtoms({ atomIds, postings })
      const actualSupportHash = supportHash(support)
      const expectedSupportHash = toText(row?.supportHash)
      if (expectedSupportHash && expectedSupportHash !== actualSupportHash) {
        throw new Error(
          `checkpoint frontier support hash mismatch at ${context.filePath}:${context.lineNumber}: checkpoint=${expectedSupportHash} actual=${actualSupportHash}`,
        )
      }
      frontier.push({ atomIds, support, supportHash: actualSupportHash })
    },
  })
  if (seenSupport.size !== Number(checkpoint.seenSupportCount ?? seenSupport.size)) {
    throw new Error(`checkpoint seenSupportCount mismatch: expected=${checkpoint.seenSupportCount} actual=${seenSupport.size}`)
  }
  if (frontier.length !== Number(checkpoint.frontierSize ?? frontier.length)) {
    throw new Error(`checkpoint frontierSize mismatch: expected=${checkpoint.frontierSize} actual=${frontier.length}`)
  }
  return {
    checkpoint,
    seenSupport,
    frontier,
    statusCounts: mapFromObject(checkpoint.statusCounts),
    rejectedReasonCounts: mapFromObject(checkpoint.rejectedReasonCounts),
    deadEndReasonCounts: mapFromObject(checkpoint.deadEndReasonCounts),
    counters: checkpoint.counters ?? {},
  }
}

export const mineTp12Train100CounterexampleExactCompletion = async ({
  contractPath,
  atomEventsPath,
  outCatalogPath,
  outManifestPath,
  outTracePath = "",
  outProgressPath = "",
  outCheckpointPath = "",
  resumeCheckpointPath = "",
  checkpointEveryStates = 0,
  maxVisitedStates = 50000,
  maxAdditionalVisitedStates = 0,
  maxSeeds = 0,
  maxCounterexampleScan = 16,
  frontierPartitionCount = 1,
  frontierPartitionIndex = 0,
  progressEveryStates = 1000,
  allowIncomplete = false,
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  const target = targetOptionsFromContract(contract)
  const mining = miningOptionsFromContract(contract)
  const coreYears = coreYearsFromContract(contract)
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  if (!toText(outManifestPath)) throw new Error("outManifestPath is required")
  const { rows, postings, atomById } = await loadAtomDataset({ atomEventsPath, contract, includeRowAtomBits: true })
  const allSeeds = completionSeedAtoms({ rows, postings, target, coreYears })
  if (allSeeds.length < 1) throw new Error("zero completion seed atoms after train100 year-gate prefilter")
  const effectiveMaxSeeds = Math.max(0, Math.trunc(toNumber(maxSeeds, 0)))
  const seeds = effectiveMaxSeeds > 0 ? allSeeds.slice(0, effectiveMaxSeeds) : allSeeds
  let effectiveMaxVisitedStates = Math.max(1, Math.trunc(toNumber(maxVisitedStates, 50000)))
  const effectiveMaxAdditionalVisitedStates = Math.max(0, Math.trunc(toNumber(maxAdditionalVisitedStates, 0)))
  const effectiveMaxCounterexampleScan = Math.max(1, Math.trunc(toNumber(maxCounterexampleScan, 16)))
  const effectiveFrontierPartitionCount = Math.max(1, Math.trunc(toNumber(frontierPartitionCount, 1)))
  const effectiveFrontierPartitionIndex = Math.trunc(toNumber(frontierPartitionIndex, 0))
  if (effectiveFrontierPartitionIndex < 0 || effectiveFrontierPartitionIndex >= effectiveFrontierPartitionCount) {
    throw new Error(
      `invalid frontier partition index/count: index=${effectiveFrontierPartitionIndex} count=${effectiveFrontierPartitionCount}`,
    )
  }
  if (effectiveFrontierPartitionCount > 1 && !toText(resumeCheckpointPath)) {
    throw new Error("frontier partitioning requires --resume-checkpoint so the source frontier is explicit")
  }
  const effectiveProgressEveryStates = Math.max(1, Math.trunc(toNumber(progressEveryStates, 1000)))
  const effectiveCheckpointEveryStates = Math.max(0, Math.trunc(toNumber(checkpointEveryStates, 0)))
  await ensureDir(path.dirname(outCatalogPath))
  const catalogStream = fs.createWriteStream(outCatalogPath, { encoding: "utf8" })
  const traceStream = toText(outTracePath) ? fs.createWriteStream(outTracePath, { encoding: "utf8" }) : null
  let seenSupport = new Set()
  const seenSupportDelta = new Set()
  const seenAccepted = new Set()
  let statusCounts = new Map()
  let rejectedReasonCounts = new Map()
  let deadEndReasonCounts = new Map()
  let visitedStateCount = 0
  let evaluatedCandidateCount = 0
  let emittedCandidateCount = 0
  let acceptedCandidateCount = 0
  let traceRowCount = 0
  let maxFrontierSize = 0
  let branchRowCount = 0
  let counterexampleRowsScanned = 0
  let searchComplete = true
  let completionReason = "frontier_exhausted"
  const frontier = []
  let resumeSourceCounters = {
    visitedStateCount: 0,
    evaluatedCandidateCount: 0,
    emittedCandidateCount: 0,
    acceptedCandidateCount: 0,
    traceRowCount: 0,
    maxFrontierSize: 0,
    branchRowCount: 0,
    counterexampleRowsScanned: 0,
  }
  let frontierPartition = {
    enabled: false,
    method: "none",
    count: 1,
    index: 0,
    sourceFrontierSize: null,
    selectedFrontierSize: null,
    sourceCheckpointPath: maybeResolve(resumeCheckpointPath),
  }
  const pushState = ({ atomIds, support }) => {
    const hash = supportHash(support)
    if (seenSupport.has(hash)) return false
    seenSupport.add(hash)
    if (resumedFromCheckpoint) seenSupportDelta.add(hash)
    frontier.push({ atomIds: uniqueSorted(atomIds), support, supportHash: hash })
    if (frontier.length > maxFrontierSize) maxFrontierSize = frontier.length
    return true
  }
  let resumedFromCheckpoint = false
  let resumeCheckpoint = null
  if (toText(resumeCheckpointPath)) {
    const loaded = await loadCounterexampleCheckpoint({ checkpointPath: resumeCheckpointPath, contractPath, atomEventsPath, postings })
    resumedFromCheckpoint = true
    resumeCheckpoint = loaded.checkpoint
    seenSupport = loaded.seenSupport
    statusCounts = loaded.statusCounts
    rejectedReasonCounts = loaded.rejectedReasonCounts
    deadEndReasonCounts = loaded.deadEndReasonCounts
    frontier.push(...loaded.frontier)
    visitedStateCount = Math.max(0, Math.trunc(toNumber(loaded.counters.visitedStateCount, 0)))
    evaluatedCandidateCount = Math.max(0, Math.trunc(toNumber(loaded.counters.evaluatedCandidateCount, visitedStateCount)))
    emittedCandidateCount = Math.max(0, Math.trunc(toNumber(loaded.counters.emittedCandidateCount, 0)))
    acceptedCandidateCount = Math.max(0, Math.trunc(toNumber(loaded.counters.acceptedCandidateCount, 0)))
    traceRowCount = Math.max(0, Math.trunc(toNumber(loaded.counters.traceRowCount, 0)))
    maxFrontierSize = Math.max(frontier.length, Math.trunc(toNumber(loaded.counters.maxFrontierSize, frontier.length)))
    branchRowCount = Math.max(0, Math.trunc(toNumber(loaded.counters.branchRowCount, 0)))
    counterexampleRowsScanned = Math.max(0, Math.trunc(toNumber(loaded.counters.counterexampleRowsScanned, 0)))
    resumeSourceCounters = {
      visitedStateCount,
      evaluatedCandidateCount,
      emittedCandidateCount,
      acceptedCandidateCount,
      traceRowCount,
      maxFrontierSize,
      branchRowCount,
      counterexampleRowsScanned,
    }
    if (effectiveMaxAdditionalVisitedStates > 0) {
      effectiveMaxVisitedStates = visitedStateCount + effectiveMaxAdditionalVisitedStates
    }
    if (effectiveFrontierPartitionCount > 1) {
      if (loaded.checkpoint?.options?.frontierPartition?.enabled) {
        throw new Error("cannot apply frontier partitioning to an already partitioned checkpoint; resume the shard directly")
      }
      const sourceFrontier = [...frontier]
      const selectedFrontier = sourceFrontier.filter(
        (state) => frontierPartitionBucket(state.supportHash, effectiveFrontierPartitionCount) === effectiveFrontierPartitionIndex,
      )
      frontier.length = 0
      frontier.push(...selectedFrontier)
      frontierPartition = {
        enabled: true,
        method: "support_hash_mod_v1",
        count: effectiveFrontierPartitionCount,
        index: effectiveFrontierPartitionIndex,
        sourceFrontierSize: sourceFrontier.length,
        selectedFrontierSize: selectedFrontier.length,
        sourceCheckpointPath: path.resolve(resumeCheckpointPath),
      }
    } else if (loaded.checkpoint?.options?.frontierPartition?.enabled) {
      frontierPartition = loaded.checkpoint.options.frontierPartition
    }
  } else {
    // The frontier is a LIFO stack. Push weaker seeds first so the sorted best seed
    // is popped first; otherwise broad family atoms dominate the first search wave.
    for (let seedIndex = seeds.length - 1; seedIndex >= 0; seedIndex -= 1) {
      const seed = seeds[seedIndex]
      pushState({ atomIds: [seed.atomId], support: postings.get(seed.atomId) })
    }
    if (seeds.length < allSeeds.length) {
      searchComplete = false
      completionReason = "seed_limit_applied"
    }
  }
  const checkpointOptions = () => ({
    target,
    mining,
    coreYears,
    maxVisitedStates: effectiveMaxVisitedStates,
    maxSeeds: effectiveMaxSeeds,
    maxCounterexampleScan: effectiveMaxCounterexampleScan,
    maxAdditionalVisitedStates: effectiveMaxAdditionalVisitedStates,
    progressEveryStates: effectiveProgressEveryStates,
    checkpointEveryStates: effectiveCheckpointEveryStates,
    allowIncomplete: toBool(allowIncomplete, false),
    searchStrategy: "counterexample_exact_completion",
    resumedFromCheckpoint,
    resumeCheckpointPath: maybeResolve(resumeCheckpointPath),
    frontierPartition,
  })
  const checkpointCounters = () => ({
    visitedStateCount,
    evaluatedCandidateCount,
    emittedCandidateCount,
    acceptedCandidateCount,
    traceRowCount,
    maxFrontierSize,
    branchRowCount,
    counterexampleRowsScanned,
  })
  let lastCheckpointStateCount = visitedStateCount
  const maybeWriteCheckpoint = async (phase) => {
    if (!toText(outCheckpointPath)) return null
    return writeCounterexampleCheckpoint({
      checkpointPath: outCheckpointPath,
      contractPath,
      atomEventsPath,
      frontier,
      seenSupport,
      seenSupportDelta,
      baseCheckpointPath: resumedFromCheckpoint ? resumeCheckpointPath : "",
      statusCounts,
      rejectedReasonCounts,
      deadEndReasonCounts,
      counters: {
        ...checkpointCounters(),
        phase,
      },
      options: checkpointOptions(),
    })
  }
  const writeTrace = async (row) => {
    if (!traceStream) return
    await writeJsonlRow(traceStream, row)
    traceRowCount += 1
  }
  const writeProgress = async (phase, extra = {}) => {
    if (!toText(outProgressPath)) return
    await writeJson(outProgressPath, {
      kind: "tp12_train100_counterexample_exact_completion_progress_v1",
      generatedAt: new Date().toISOString(),
      status: "running",
      phase,
      visitedStateCount,
      evaluatedCandidateCount,
      emittedCandidateCount,
      acceptedCandidateCount,
      frontierSize: frontier.length,
      maxFrontierSize,
      frontierPartition,
      outCheckpointPath: maybeResolve(outCheckpointPath),
      resumeCheckpointPath: maybeResolve(resumeCheckpointPath),
      resumedFromCheckpoint,
      ...extra,
    })
  }
  await writeProgress("search_started")
  try {
    while (frontier.length > 0) {
      if (visitedStateCount >= effectiveMaxVisitedStates) {
        searchComplete = false
        completionReason = "max_visited_states_reached"
        break
      }
      const state = frontier.pop()
      visitedStateCount += 1
      evaluatedCandidateCount += 1
      const currentStats = supportGateStats({ support: state.support, rows, target, coreYears })
      const quickRow = quickCandidateAssessment({
        atomIds: state.atomIds,
        support: state.support,
        target,
        coreYears,
        gateStats: currentStats,
      })
      incrementMap(statusCounts, quickRow.qualityPassed ? "accepted_train100" : "rejected")
      for (const reason of quickRow.rejectReasons) incrementMap(rejectedReasonCounts, reason)
      if (quickRow.qualityPassed) {
        const key = state.supportHash
        if (!seenAccepted.has(key)) {
          seenAccepted.add(key)
          const row = candidateMetrics({
            atomIds: state.atomIds,
            support: state.support,
            rows,
            target,
            coreYears,
            searchStrategy: "counterexample_exact_completion",
          })
          await writeJsonlRow(catalogStream, row)
          emittedCandidateCount += 1
          acceptedCandidateCount += 1
          await writeTrace({
            kind: "tp12_train100_counterexample_exact_completion_trace_v1",
            phase: "accepted",
            atomIds: state.atomIds,
            supportHash: state.supportHash,
            matchRows: row.matchRows,
            hitRows: row.hitRows,
          })
        }
        continue
      }
      if (!currentStats.canMeetYearGate || currentStats.hitRows < target.minPositiveSymbolDatesTotal) {
        incrementMap(deadEndReasonCounts, "cannot_meet_year_gate_or_positive_total")
        continue
      }
      if (state.atomIds.length >= mining.maxPatternAtoms) {
        incrementMap(deadEndReasonCounts, "max_pattern_atoms_reached")
        await writeTrace({
          kind: "tp12_train100_counterexample_exact_completion_trace_v1",
          phase: "dead_end",
          reason: "max_pattern_atoms_reached",
          atomIds: state.atomIds,
          supportHash: state.supportHash,
          falsePositiveRows: currentStats.falsePositiveRows,
        })
        continue
      }
      const chosen = chooseCounterexampleBranches({
        support: state.support,
        atomIds: state.atomIds,
        rows,
        postings,
        atomById,
        target,
        coreYears,
        currentStats,
        maxCounterexampleScan: effectiveMaxCounterexampleScan,
      })
      counterexampleRowsScanned += chosen?.scannedCounterexampleRows ?? 0
      if (!chosen || chosen.branches.length < 1) {
        incrementMap(deadEndReasonCounts, "no_counterexample_extension_preserves_year_gate")
        await writeTrace({
          kind: "tp12_train100_counterexample_exact_completion_trace_v1",
          phase: "dead_end",
          reason: "no_counterexample_extension_preserves_year_gate",
          atomIds: state.atomIds,
          supportHash: state.supportHash,
          falsePositiveRows: currentStats.falsePositiveRows,
          counterexample: chosen?.counterexample ?? null,
        })
        continue
      }
      branchRowCount += chosen.branches.length
      await writeTrace({
        kind: "tp12_train100_counterexample_exact_completion_trace_v1",
        phase: "counterexample_branch",
        atomIds: state.atomIds,
        supportHash: state.supportHash,
        falsePositiveRows: currentStats.falsePositiveRows,
        counterexample: chosen.counterexample,
        branchCount: chosen.branches.length,
        bestBranch: {
          atomId: chosen.branches[0].atomId,
          matchRows: chosen.branches[0].nextSupport.length,
          hitRows: chosen.branches[0].stats.hitRows,
          falsePositiveRows: chosen.branches[0].stats.falsePositiveRows,
          removedNegatives: chosen.branches[0].removedNegatives,
          removedPositives: chosen.branches[0].removedPositives,
        },
      })
      for (let index = chosen.branches.length - 1; index >= 0; index -= 1) {
        const branch = chosen.branches[index]
        pushState({
          atomIds: [...state.atomIds, branch.atomId],
          support: branch.nextSupport,
        })
      }
      if (visitedStateCount % effectiveProgressEveryStates === 0) {
        await writeProgress("searching")
      }
      if (
        effectiveCheckpointEveryStates > 0 &&
        visitedStateCount - lastCheckpointStateCount >= effectiveCheckpointEveryStates
      ) {
        await maybeWriteCheckpoint("searching")
        lastCheckpointStateCount = visitedStateCount
      }
    }
  } finally {
    await closeWriteStream(catalogStream)
    if (traceStream) await closeWriteStream(traceStream)
  }
  const checkpoint = await maybeWriteCheckpoint(searchComplete ? "completed" : "incomplete")
  const status = searchComplete ? "passed" : "incomplete"
  const manifest = {
    kind: "tp12_train100_counterexample_exact_completion_manifest_v1",
    generatedAt: new Date().toISOString(),
    status,
    searchComplete,
    completionReason,
    contractPath: path.resolve(contractPath),
    atomEventsPath: path.resolve(atomEventsPath),
    outCatalogPath: path.resolve(outCatalogPath),
    outTracePath: maybeResolve(outTracePath),
    outProgressPath: maybeResolve(outProgressPath),
    outCheckpointPath: maybeResolve(outCheckpointPath),
    resumeCheckpointPath: maybeResolve(resumeCheckpointPath),
    resumedFromCheckpoint,
    resumeCheckpointGeneratedAt: resumeCheckpoint?.generatedAt ?? null,
    resumeSourceCounters,
    checkpointPath: checkpoint?.status === "checkpoint" ? path.resolve(outCheckpointPath) : null,
    checkpointSeenSupportPath: checkpoint?.seenSupportPath ?? null,
    checkpointFrontierPath: checkpoint?.frontierPath ?? null,
    trainEventCount: rows.length,
    atomCount: postings.size,
    seedAtomCount: seeds.length,
    availableSeedAtomCount: allSeeds.length,
    seedLimitApplied: seeds.length < allSeeds.length,
    visitedStateCount,
    evaluatedCandidateCount,
    emittedCandidateCount,
    acceptedCandidateCount,
    traceRowCount,
    newVisitedStateCount: visitedStateCount - resumeSourceCounters.visitedStateCount,
    newEvaluatedCandidateCount: evaluatedCandidateCount - resumeSourceCounters.evaluatedCandidateCount,
    newEmittedCandidateCount: emittedCandidateCount - resumeSourceCounters.emittedCandidateCount,
    newAcceptedCandidateCount: acceptedCandidateCount - resumeSourceCounters.acceptedCandidateCount,
    newTraceRowCount: traceRowCount - resumeSourceCounters.traceRowCount,
    newBranchRowCount: branchRowCount - resumeSourceCounters.branchRowCount,
    newCounterexampleRowsScanned: counterexampleRowsScanned - resumeSourceCounters.counterexampleRowsScanned,
    maxFrontierSize,
    remainingFrontierSize: frontier.length,
    branchRowCount,
    counterexampleRowsScanned,
    statusCounts: mapToSortedObject(statusCounts),
    rejectedReasonCounts: mapToSortedObject(rejectedReasonCounts),
    deadEndReasonCounts: mapToSortedObject(deadEndReasonCounts),
    options: {
      target,
      mining,
      coreYears,
      maxVisitedStates: effectiveMaxVisitedStates,
      maxSeeds: effectiveMaxSeeds,
      maxCounterexampleScan: effectiveMaxCounterexampleScan,
      maxAdditionalVisitedStates: effectiveMaxAdditionalVisitedStates,
      progressEveryStates: effectiveProgressEveryStates,
      checkpointEveryStates: effectiveCheckpointEveryStates,
      allowIncomplete: toBool(allowIncomplete, false),
      searchStrategy: "counterexample_exact_completion",
      resumedFromCheckpoint,
      frontierPartition,
    },
    topSeedAtoms: seeds.slice(0, 100),
  }
  await writeJson(outManifestPath, manifest)
  if (toText(outProgressPath)) {
    await writeJson(outProgressPath, {
      kind: "tp12_train100_counterexample_exact_completion_progress_v1",
      generatedAt: new Date().toISOString(),
      status,
      phase: searchComplete ? "completed" : "incomplete",
      visitedStateCount,
      evaluatedCandidateCount,
      emittedCandidateCount,
      acceptedCandidateCount,
      frontierSize: frontier.length,
      completionReason,
      frontierPartition,
    })
  }
  if (!searchComplete && !toBool(allowIncomplete, false)) {
    throw new Error(`tp12 train100 counterexample exact completion incomplete: ${completionReason}`)
  }
  return manifest
}

const scoreEliminationAtom = ({ support, atomSupport, rows, positiveBefore, negativeBefore, target, coreYears }) => {
  const nextSupport = []
  let negativeAfter = 0
  let positiveAfter = 0
  const yearDates = new Map(coreYears.map((year) => [String(year), new Set()]))
  const yearSymbolDates = new Map(coreYears.map((year) => [String(year), new Set()]))
  let left = 0
  let right = 0
  while (left < support.length && right < atomSupport.length) {
    const leftValue = support[left]
    const rightValue = atomSupport[right]
    if (leftValue === rightValue) {
      nextSupport.push(leftValue)
      if (rows.hitFlags[leftValue] === 1) {
        positiveAfter += 1
        const year = String(rows.yearValues[leftValue])
        if (yearDates.has(year)) {
          yearDates.get(year).add(rows.dateIds[leftValue])
          yearSymbolDates.get(year).add(`${rows.symbolIds[leftValue]}\t${rows.dateIds[leftValue]}`)
        }
      } else {
        negativeAfter += 1
      }
      left += 1
      right += 1
    } else if (leftValue < rightValue) {
      left += 1
    } else {
      right += 1
    }
  }
  if (nextSupport.length < 1) return null
  let canMeetYearGate = true
  for (const year of coreYears) {
    const key = String(year)
    if (yearDates.get(key).size < target.minHitDecisionDatesPerYear) canMeetYearGate = false
    if (yearSymbolDates.get(key).size < target.minHitSymbolDatesPerYear) canMeetYearGate = false
  }
  return {
    nextSupport,
    positiveBefore,
    negativeBefore,
    positiveAfter,
    negativeAfter,
    removedNegatives: negativeBefore - negativeAfter,
    removedPositives: positiveBefore - positiveAfter,
    canMeetYearGate,
  }
}

const rankNegativeEliminationBranches = (left, right) =>
  left.negativeAfter - right.negativeAfter ||
  right.removedNegatives - left.removedNegatives ||
  left.removedPositives - right.removedPositives ||
  left.atomId.localeCompare(right.atomId)

const rankNegativeEliminationStates = (left, right) =>
  left.negativeRows - right.negativeRows ||
  right.hitRows - left.hitRows ||
  left.atomIds.length - right.atomIds.length ||
  candidateKey(left.atomIds).localeCompare(candidateKey(right.atomIds))

const equalUint32Arrays = (left, right) => {
  if (!left || !right || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const pushRankedBranch = (branches, branch, branchCount) => {
  if (branches.some((existing) => equalUint32Arrays(existing.nextSupport, branch.nextSupport))) return
  branches.push(branch)
  branches.sort(rankNegativeEliminationBranches)
  if (branches.length > branchCount) branches.length = branchCount
}

export const mineTp12Train100NegativeEliminationCandidates = async ({
  contractPath,
  atomEventsPath,
  outCatalogPath,
  outTracePath,
  outManifestPath,
  maxSteps = 6,
  maxSeeds = 200,
  beamWidth = 1,
  branchCount = 1,
  maxVisitedStates = 50000,
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  const target = targetOptionsFromContract(contract)
  const mining = miningOptionsFromContract(contract)
  const coreYears = coreYearsFromContract(contract)
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  if (!toText(outTracePath)) throw new Error("outTracePath is required")
  if (!toText(outManifestPath)) throw new Error("outManifestPath is required")
  const { rows, postings } = await loadAtomDataset({ atomEventsPath, contract })
  const seeds = seedAtoms({ rows, postings, target, mining, coreYears }).slice(0, Math.max(1, Math.trunc(toNumber(maxSeeds, 200))))
  if (seeds.length < 1) throw new Error("zero seed atoms after train100 negative-elimination seed prefilter")
  await ensureDir(path.dirname(outCatalogPath))
  const catalogStream = fs.createWriteStream(outCatalogPath, { encoding: "utf8" })
  const traceStream = fs.createWriteStream(outTracePath, { encoding: "utf8" })
  let emittedCandidateCount = 0
  let acceptedCandidateCount = 0
  let traceRowCount = 0
  let visitedStateCount = 0
  const seenAccepted = new Set()
  const effectiveMaxSteps = Math.max(1, Math.trunc(toNumber(maxSteps, 6)))
  const effectiveMaxSeeds = Math.max(1, Math.trunc(toNumber(maxSeeds, 200)))
  const effectiveBeamWidth = Math.max(1, Math.trunc(toNumber(beamWidth, 1)))
  const effectiveBranchCount = Math.max(1, Math.trunc(toNumber(branchCount, 1)))
  const effectiveMaxVisitedStates = Math.max(1, Math.trunc(toNumber(maxVisitedStates, 50000)))
  const searchStrategy = effectiveBeamWidth === 1 && effectiveBranchCount === 1
    ? "negative_elimination_greedy"
    : "negative_elimination_beam"
  try {
    for (const seed of seeds) {
      await writeJsonlRow(traceStream, {
        kind: "tp12_train100_negative_elimination_trace_v1",
        seedAtomId: seed.atomId,
        phase: "seed_started",
        searchStrategy,
        beamWidth: effectiveBeamWidth,
        branchCount: effectiveBranchCount,
        seedMatchRows: seed.matchRows,
        seedHitRows: seed.hitRows,
        seedFalsePositiveRows: seed.falsePositiveRows,
      })
      traceRowCount += 1
      let frontier = [{ atomIds: [seed.atomId], support: postings.get(seed.atomId) }]
      const seenStatesForSeed = new Set([candidateKey(frontier[0].atomIds)])
      for (let step = 1; step <= effectiveMaxSteps && frontier.length > 0; step += 1) {
        const nextFrontier = []
        for (const state of frontier) {
          visitedStateCount += 1
          if (visitedStateCount > effectiveMaxVisitedStates) {
            throw new Error(`train100 negative-elimination exceeded maxVisitedStates=${effectiveMaxVisitedStates}`)
          }
          const { atomIds, support } = state
          const current = candidateMetrics({ atomIds, support, rows, target, coreYears, searchStrategy })
        if (current.qualityPassed) {
          const key = candidateKey(atomIds)
          if (!seenAccepted.has(key)) {
            seenAccepted.add(key)
            await writeJsonlRow(catalogStream, current)
            emittedCandidateCount += 1
            acceptedCandidateCount += 1
          }
          continue
        }
          if (atomIds.length >= mining.maxPatternAtoms) {
            await writeJsonlRow(traceStream, {
              kind: "tp12_train100_negative_elimination_trace_v1",
              seedAtomId: seed.atomId,
              step,
              atomIds,
              searchStrategy,
              stopped: true,
              stopReason: "max_pattern_atoms_reached",
            })
            traceRowCount += 1
            continue
          }
          const branches = []
        for (const [atomId, atomSupport] of postings.entries()) {
          if (atomIds.includes(atomId)) continue
          const scored = scoreEliminationAtom({
            support,
            atomSupport,
            rows,
            positiveBefore: current.hitRows,
            negativeBefore: current.falsePositiveRows,
            target,
            coreYears,
          })
          if (!scored || scored.removedNegatives <= 0) continue
          if (!scored.canMeetYearGate) continue
          const candidate = { atomId, ...scored }
            pushRankedBranch(branches, candidate, effectiveBranchCount)
        }
          if (branches.length < 1) {
          await writeJsonlRow(traceStream, {
            kind: "tp12_train100_negative_elimination_trace_v1",
            seedAtomId: seed.atomId,
            step,
            atomIds,
              searchStrategy,
            stopped: true,
            stopReason: "no_negative_reducing_extension_preserves_year2hit",
          })
          traceRowCount += 1
            continue
        }
          let branchRank = 0
          for (const branch of branches) {
            branchRank += 1
            const nextAtomIds = uniqueSorted([...atomIds, branch.atomId])
            const stateKey = candidateKey(nextAtomIds)
            if (seenStatesForSeed.has(stateKey)) continue
            seenStatesForSeed.add(stateKey)
        await writeJsonlRow(traceStream, {
          kind: "tp12_train100_negative_elimination_trace_v1",
          seedAtomId: seed.atomId,
          step,
              branchRank,
              searchStrategy,
              beamWidth: effectiveBeamWidth,
              branchCount: effectiveBranchCount,
              addedAtomId: branch.atomId,
          atomIdsBefore: atomIds,
              positiveRowsBefore: branch.positiveBefore,
              negativeRowsBefore: branch.negativeBefore,
              positiveRowsAfter: branch.positiveAfter,
              negativeRowsAfter: branch.negativeAfter,
              removedNegatives: branch.removedNegatives,
              removedPositives: branch.removedPositives,
        })
        traceRowCount += 1
            nextFrontier.push({
              atomIds: nextAtomIds,
              support: branch.nextSupport,
              hitRows: branch.positiveAfter,
              negativeRows: branch.negativeAfter,
            })
          }
        }
        nextFrontier.sort(rankNegativeEliminationStates)
        frontier = nextFrontier.slice(0, effectiveBeamWidth)
      }
    }
  } finally {
    await closeWriteStream(catalogStream)
    await closeWriteStream(traceStream)
  }
  const manifest = {
    kind: "tp12_train100_negative_elimination_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    contractPath: path.resolve(contractPath),
    atomEventsPath: path.resolve(atomEventsPath),
    outCatalogPath: path.resolve(outCatalogPath),
    outTracePath: path.resolve(outTracePath),
    trainEventCount: rows.length,
    atomCount: postings.size,
    seedAtomCount: seeds.length,
    emittedCandidateCount,
    acceptedCandidateCount,
    traceRowCount,
    visitedStateCount,
    options: {
      target,
      mining,
      coreYears,
      maxSteps: effectiveMaxSteps,
      maxSeeds: effectiveMaxSeeds,
      beamWidth: effectiveBeamWidth,
      branchCount: effectiveBranchCount,
      maxVisitedStates: effectiveMaxVisitedStates,
      searchStrategy,
    },
  }
  await writeJson(outManifestPath, manifest)
  return manifest
}

const loadCandidateRows = async (catalogPaths) => {
  const rows = []
  for (const catalogPath of catalogPaths.map(toText).filter(Boolean)) {
    if (!fs.existsSync(catalogPath)) throw new Error(`candidate catalog not found: ${catalogPath}`)
    await iterateJsonlMaybeGzip(catalogPath, {
      strict: true,
      onRow: async (row, context) => {
        const patternId = toText(row?.patternId)
        if (!patternId) throw new Error(`candidate row missing patternId at ${context.filePath}:${context.lineNumber}`)
        rows.push({ ...row, sourceCatalogPath: path.resolve(catalogPath) })
      },
    })
  }
  return rows
}

export const assertTp12Train100QualityGate = async ({
  contractPath,
  candidateCatalogPaths = [],
  outAcceptedPath,
  outRejectedPath = "",
  outSummaryPath,
} = {}) => {
  const contract = await loadTp12Train100Contract(contractPath)
  const target = targetOptionsFromContract(contract)
  const quality = qualityOptionsFromContract(contract)
  if (!Array.isArray(candidateCatalogPaths) || candidateCatalogPaths.length < 1) {
    throw new Error("candidateCatalogPaths must contain at least one catalog")
  }
  if (!toText(outAcceptedPath)) throw new Error("outAcceptedPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const rows = await loadCandidateRows(candidateCatalogPaths)
  await ensureDir(path.dirname(outAcceptedPath))
  const acceptedStream = fs.createWriteStream(outAcceptedPath, { encoding: "utf8" })
  const rejectedStream = toText(outRejectedPath) ? fs.createWriteStream(outRejectedPath, { encoding: "utf8" }) : null
  const acceptedIds = []
  const rejectReasonCounts = new Map()
  let acceptedCount = 0
  let rejectedCount = 0
  try {
    for (const row of rows) {
      const reasons = [...(Array.isArray(row.rejectReasons) ? row.rejectReasons : [])]
      if (row.falsePositiveRows > target.maxFalsePositiveRows) reasons.push("false_positive_rows_above_max")
      if (row.trainPrecision < target.requiredTrainPrecision) reasons.push("train_precision_below_required")
      if (row.hitRows < target.minPositiveSymbolDatesTotal) reasons.push("positive_symbol_dates_below_min_total")
      if (quality.requireVerificationComplete && row.verificationComplete !== true) reasons.push("verification_not_complete")
      if (toNumber(row.topSymbolShare, 0) > quality.maxTopSymbolShare) reasons.push("top_symbol_share_above_max")
      if (toNumber(row.topDateShare, 0) > quality.maxTopDateShare) reasons.push("top_date_share_above_max")
      if (toNumber(row.topYearShare, 0) > quality.maxTopYearShare) reasons.push("top_year_share_above_max")
      const yearStats = row.yearStats ?? {}
      for (const year of coreYearsFromContract(contract)) {
        const stats = yearStats[String(year)] ?? {}
        if (toNumber(stats.hitDecisionDates, 0) < target.minHitDecisionDatesPerYear) {
          reasons.push(`year_${year}_hit_decision_dates_below_min`)
        }
        if (toNumber(stats.hitSymbolDates, 0) < target.minHitSymbolDatesPerYear) {
          reasons.push(`year_${year}_hit_symbol_dates_below_min`)
        }
      }
      const uniqueReasons = uniqueSorted(reasons)
      if (uniqueReasons.length === 0) {
        acceptedCount += 1
        acceptedIds.push(row.patternId)
        await writeJsonlRow(acceptedStream, { ...row, kind: "tp12_train100_accepted_candidate_v1", qualityPassed: true, rejectReasons: [] })
      } else {
        rejectedCount += 1
        for (const reason of uniqueReasons) incrementMap(rejectReasonCounts, reason)
        if (rejectedStream) {
          await writeJsonlRow(rejectedStream, { ...row, kind: "tp12_train100_rejected_candidate_v1", qualityPassed: false, rejectReasons: uniqueReasons })
        }
      }
    }
  } finally {
    await closeWriteStream(acceptedStream)
    if (rejectedStream) await closeWriteStream(rejectedStream)
  }
  const failures = []
  if (acceptedCount < 1 && quality.failOnZeroAccepted) failures.push("zero_accepted_train100_candidates")
  const summary = {
    kind: "tp12_train100_quality_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    candidateCatalogPaths: candidateCatalogPaths.map((item) => path.resolve(item)),
    outAcceptedPath: path.resolve(outAcceptedPath),
    outRejectedPath: maybeResolve(outRejectedPath),
    inputCandidateCount: rows.length,
    acceptedCount,
    rejectedCount,
    acceptedPatternIdsSha256: sha256(acceptedIds.sort().join("\n")),
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    options: { target, quality },
    failures,
  }
  await writeJson(outSummaryPath, summary)
  if (summary.status !== "passed") throw new Error(`tp12 train100 quality gate failed: ${failures.join("; ")}`)
  return summary
}

export const buildTp12Train100DiscoveryReport = async ({
  contractPath,
  preflightSummaryPath = "",
  atomManifestPath = "",
  exactManifestPath = "",
  negativeManifestPath = "",
  negativeManifestPaths = [],
  counterexampleManifestPath = "",
  counterexampleManifestPaths = [],
  qualitySummaryPath,
  outJsonPath,
  outMarkdownPath = "",
} = {}) => {
  if (!toText(qualitySummaryPath)) throw new Error("qualitySummaryPath is required")
  if (!toText(outJsonPath)) throw new Error("outJsonPath is required")
  const contract = await loadTp12Train100Contract(contractPath)
  const preflight = toText(preflightSummaryPath) ? await readJson(preflightSummaryPath, null) : null
  const atomManifest = toText(atomManifestPath) ? await readJson(atomManifestPath, null) : null
  const exactManifest = toText(exactManifestPath) ? await readJson(exactManifestPath, null) : null
  const resolvedNegativeManifestPaths = [
    ...negativeManifestPaths.map(toText).filter(Boolean),
    ...(!negativeManifestPaths.length && toText(negativeManifestPath) ? [negativeManifestPath] : []),
  ]
  const negativeManifests = []
  for (const manifestPath of resolvedNegativeManifestPaths) {
    const manifest = await readJson(manifestPath, null)
    if (!manifest) throw new Error(`negative-elimination manifest not found: ${manifestPath}`)
    negativeManifests.push({ manifestPath: path.resolve(manifestPath), manifest })
  }
  const resolvedCounterexampleManifestPaths = [
    ...counterexampleManifestPaths.map(toText).filter(Boolean),
    ...(!counterexampleManifestPaths.length && toText(counterexampleManifestPath) ? [counterexampleManifestPath] : []),
  ]
  const counterexampleManifests = []
  for (const manifestPath of resolvedCounterexampleManifestPaths) {
    const manifest = await readJson(manifestPath, null)
    if (!manifest) throw new Error(`counterexample exact-completion manifest not found: ${manifestPath}`)
    counterexampleManifests.push({ manifestPath: path.resolve(manifestPath), manifest })
  }
  const negativeManifest = negativeManifests[0]?.manifest ?? null
  const counterexampleManifest = counterexampleManifests[0]?.manifest ?? null
  const qualitySummary = await readJson(qualitySummaryPath, null)
  if (!qualitySummary) throw new Error(`quality summary not found: ${qualitySummaryPath}`)
  const negativeEliminationRuns = negativeManifests.map(({ manifestPath, manifest }) => ({
    manifestPath,
    status: manifest.status ?? null,
    searchStrategy: manifest.options?.searchStrategy ?? "negative_elimination_greedy",
    seedAtomCount: manifest.seedAtomCount ?? null,
    traceRowCount: manifest.traceRowCount ?? null,
    visitedStateCount: manifest.visitedStateCount ?? null,
    acceptedCandidateCount: manifest.acceptedCandidateCount ?? null,
    options: {
      maxSteps: manifest.options?.maxSteps ?? null,
      maxSeeds: manifest.options?.maxSeeds ?? null,
      beamWidth: manifest.options?.beamWidth ?? null,
      branchCount: manifest.options?.branchCount ?? null,
      maxVisitedStates: manifest.options?.maxVisitedStates ?? null,
    },
  }))
  const counterexampleExactCompletionRuns = counterexampleManifests.map(({ manifestPath, manifest }) => ({
    manifestPath,
    status: manifest.status ?? null,
    searchComplete: manifest.searchComplete ?? null,
    completionReason: manifest.completionReason ?? null,
    seedAtomCount: manifest.seedAtomCount ?? null,
    availableSeedAtomCount: manifest.availableSeedAtomCount ?? null,
    visitedStateCount: manifest.visitedStateCount ?? null,
    evaluatedCandidateCount: manifest.evaluatedCandidateCount ?? null,
    acceptedCandidateCount: manifest.acceptedCandidateCount ?? null,
    maxFrontierSize: manifest.maxFrontierSize ?? null,
    options: {
      maxVisitedStates: manifest.options?.maxVisitedStates ?? null,
      maxSeeds: manifest.options?.maxSeeds ?? null,
      maxCounterexampleScan: manifest.options?.maxCounterexampleScan ?? null,
      allowIncomplete: manifest.options?.allowIncomplete ?? null,
    },
  }))
  const summary = {
    kind: "tp12_train100_discovery_report_v1",
    generatedAt: new Date().toISOString(),
    patchKey: toText(contract?.patchKey),
    oosRead: false,
    preflightStatus: preflight?.status ?? null,
    atomCount: atomManifest?.atomCount ?? null,
    trainEventCount:
      atomManifest?.outputRowCount ??
      exactManifest?.trainEventCount ??
      negativeManifest?.trainEventCount ??
      counterexampleManifest?.trainEventCount ??
      null,
    exactEvaluatedCandidateCount: exactManifest?.evaluatedCandidateCount ?? null,
    exactAcceptedCandidateCount: exactManifest?.acceptedCandidateCount ?? null,
    negativeEliminationAcceptedCandidateCount: negativeEliminationRuns.reduce(
      (sum, row) => sum + Math.max(0, Math.trunc(toNumber(row.acceptedCandidateCount, 0))),
      0,
    ),
    negativeEliminationRuns,
    counterexampleExactCompletionAcceptedCandidateCount: counterexampleExactCompletionRuns.reduce(
      (sum, row) => sum + Math.max(0, Math.trunc(toNumber(row.acceptedCandidateCount, 0))),
      0,
    ),
    counterexampleExactCompletionRuns,
    acceptedTrain100PatternCount: qualitySummary.acceptedCount,
    qualityStatus: qualitySummary.status,
    qualityRejectReasonCounts: qualitySummary.rejectReasonCounts ?? {},
    sourcePaths: {
      contractPath: path.resolve(contractPath),
      preflightSummaryPath: maybeResolve(preflightSummaryPath),
      atomManifestPath: maybeResolve(atomManifestPath),
      exactManifestPath: maybeResolve(exactManifestPath),
      negativeManifestPath: maybeResolve(negativeManifestPath),
      negativeManifestPaths: resolvedNegativeManifestPaths.map(maybeResolve),
      counterexampleManifestPath: maybeResolve(counterexampleManifestPath),
      counterexampleManifestPaths: resolvedCounterexampleManifestPaths.map(maybeResolve),
      qualitySummaryPath: path.resolve(qualitySummaryPath),
    },
  }
  await writeJson(outJsonPath, summary)
  if (toText(outMarkdownPath)) {
    const lines = [
      "# TP12 Train100 Year2Hit Discovery Report",
      "",
      `- patchKey: \`${summary.patchKey}\``,
      `- oosRead: \`${summary.oosRead}\``,
      `- preflightStatus: \`${summary.preflightStatus ?? "n/a"}\``,
      `- atomCount: \`${summary.atomCount ?? "n/a"}\``,
      `- trainEventCount: \`${summary.trainEventCount ?? "n/a"}\``,
      `- exactEvaluatedCandidateCount: \`${summary.exactEvaluatedCandidateCount ?? "n/a"}\``,
      `- exactAcceptedCandidateCount: \`${summary.exactAcceptedCandidateCount ?? "n/a"}\``,
      `- negativeEliminationAcceptedCandidateCount: \`${summary.negativeEliminationAcceptedCandidateCount ?? "n/a"}\``,
      `- counterexampleExactCompletionAcceptedCandidateCount: \`${summary.counterexampleExactCompletionAcceptedCandidateCount ?? "n/a"}\``,
      `- acceptedTrain100PatternCount: \`${summary.acceptedTrain100PatternCount}\``,
      `- qualityStatus: \`${summary.qualityStatus}\``,
      "",
      "## Negative-Elimination Runs",
      "",
      ...summary.negativeEliminationRuns.map(
        (row) =>
          `- \`${row.searchStrategy}\`: accepted=${row.acceptedCandidateCount ?? "n/a"}, seeds=${row.seedAtomCount ?? "n/a"}, traceRows=${row.traceRowCount ?? "n/a"}, visitedStates=${row.visitedStateCount ?? "n/a"}`,
      ),
      "",
      "## Counterexample Exact-Completion Runs",
      "",
      ...summary.counterexampleExactCompletionRuns.map(
        (row) =>
          `- status=${row.status ?? "n/a"}, complete=${row.searchComplete ?? "n/a"}, reason=${row.completionReason ?? "n/a"}, accepted=${row.acceptedCandidateCount ?? "n/a"}, seeds=${row.seedAtomCount ?? "n/a"}, visitedStates=${row.visitedStateCount ?? "n/a"}`,
      ),
      "",
      "## Quality Reject Reasons",
      "",
      ...Object.entries(summary.qualityRejectReasonCounts).map(([reason, count]) => `- \`${reason}\`: ${count}`),
      "",
    ]
    await ensureDir(path.dirname(outMarkdownPath))
    await fs.promises.writeFile(outMarkdownPath, `${lines.join("\n")}\n`, "utf8")
  }
  return summary
}
