#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { pathExists, readJson } from "../src/lib/io.mjs"
import { computeFileSha256 } from "../src/lib/tp12_year2hit_gated_catalog.mjs"
import {
  deriveTp12Year2hitGateOptionsFromContract,
  sha256TextLines,
} from "../src/lib/tp12_year2hit_train_gate.mjs"

const toText = (value) => String(value ?? "").trim()
const parseBoolFlag = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback
  if (value === true || value === false) return value
  const text = toText(value).toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const assertStatusPassed = ({ payload, label, optional = false }) => {
  if (!payload) {
    if (optional) return
    throw new Error(`${label} is required`)
  }
  const status = toText(payload.status)
  if (status !== "passed") {
    throw new Error(`${label} status is not passed: ${status || "missing"}`)
  }
}

const readRequiredJson = async (filePath, label) => {
  const resolved = path.resolve(filePath)
  const payload = await readJson(resolved, null)
  if (!payload) throw new Error(`${label} not found: ${resolved}`)
  return { resolved, payload }
}

const readOptionalJson = async (filePath, label, { required = false } = {}) => {
  const text = toText(filePath)
  if (!text) {
    if (required) throw new Error(`${label} path is required`)
    return { resolved: null, payload: null, sha256: null }
  }
  const resolved = path.resolve(text)
  const payload = await readJson(resolved, null)
  if (!payload) throw new Error(`${label} not found: ${resolved}`)
  return { resolved, payload, sha256: await computeFileSha256(resolved) }
}

const assertNoTrainOosOverlap = ({ trainDateRange, oosDateRange }) => {
  const trainFrom = toText(trainDateRange?.from)
  const trainTo = toText(trainDateRange?.to)
  const oosFrom = toText(oosDateRange?.from)
  const oosTo = toText(oosDateRange?.to)
  if (!trainFrom || !trainTo || !oosFrom || !oosTo) return
  if (trainFrom <= oosTo && oosFrom <= trainTo) {
    throw new Error(`train/OOS date ranges overlap: train=${trainFrom}..${trainTo} oos=${oosFrom}..${oosTo}`)
  }
}

const sameResolvedPath = (left, right) => {
  const leftText = toText(left)
  const rightText = toText(right)
  if (!leftText || !rightText) return true
  return path.resolve(leftText) === path.resolve(rightText)
}

const assertSameResolvedPath = ({ left, right, label }) => {
  if (!sameResolvedPath(left, right)) {
    throw new Error(`${label} path mismatch: left=${left} right=${right}`)
  }
}

const assertNoFailures = ({ payload, label }) => {
  const failures = Array.isArray(payload?.failures) ? payload.failures.filter(Boolean) : []
  if (failures.length > 0) throw new Error(`${label} has failures: ${failures.join("; ")}`)
}

const assertExtendedArtifactChain = ({
  labelManifest,
  tokenDictionaryManifest,
  eventRowManifest,
  gatedCatalogManifest,
}) => {
  if (labelManifest) {
    assertNoFailures({ payload: labelManifest, label: "label manifest" })
    if (Number(labelManifest.validLabelCount ?? labelManifest.outputRowCount ?? 0) < 1) {
      throw new Error("label manifest has zero valid label rows")
    }
  }
  if (tokenDictionaryManifest) {
    assertNoFailures({ payload: tokenDictionaryManifest, label: "token dictionary manifest" })
    if (Number(tokenDictionaryManifest.outputRowCount ?? 0) < 1) {
      throw new Error("token dictionary manifest has zero tokenized rows")
    }
    assertSameResolvedPath({
      left: tokenDictionaryManifest.labelEventsPath,
      right: labelManifest?.outEventsPath,
      label: "label->token artifact",
    })
  }
  if (eventRowManifest) {
    assertNoFailures({ payload: eventRowManifest, label: "event row manifest" })
    if (Number(eventRowManifest.outputRowCount ?? 0) < 1) {
      throw new Error("event row manifest has zero candidate event rows")
    }
    assertSameResolvedPath({
      left: eventRowManifest.tokenizedEventsPath,
      right: tokenDictionaryManifest?.outEventsPath,
      label: "token->event artifact",
    })
    assertSameResolvedPath({
      left: eventRowManifest.candidateCatalogPath,
      right: gatedCatalogManifest?.sourceCatalogPath,
      label: "event->gated source catalog",
    })
  }
}

const assertSurvivorCatalogManifest = async ({
  survivorCatalogManifest,
  survivorPatternIds,
  survivorPatternIdsSha256,
  gatedCatalogManifest,
}) => {
  if (!survivorCatalogManifest) return
  if (toText(survivorCatalogManifest.survivorPatternIdsSha256) !== survivorPatternIdsSha256) {
    throw new Error(
      `survivor catalog hash mismatch: manifest=${toText(survivorCatalogManifest.survivorPatternIdsSha256)} gate=${survivorPatternIdsSha256}`,
    )
  }
  if (Number(survivorCatalogManifest.survivorCount) !== survivorPatternIds.length) {
    throw new Error(
      `survivor catalog count mismatch: manifest=${survivorCatalogManifest.survivorCount} gate=${survivorPatternIds.length}`,
    )
  }
  const survivorCatalogPath = toText(survivorCatalogManifest.outCatalogPath)
  if (!survivorCatalogPath) throw new Error("survivor catalog manifest is missing outCatalogPath")
  if (!pathExists(survivorCatalogPath)) throw new Error(`survivor catalog not found: ${survivorCatalogPath}`)
  const survivorCatalogSha256 = await computeFileSha256(survivorCatalogPath)
  if (toText(survivorCatalogManifest.outCatalogSha256) !== survivorCatalogSha256) {
    throw new Error(
      `survivor catalog sha256 mismatch: manifest=${toText(survivorCatalogManifest.outCatalogSha256)} actual=${survivorCatalogSha256}`,
    )
  }
  const gatedSourceSha256 = toText(gatedCatalogManifest?.sourceCatalogSha256)
  const survivorSourceSha256 = toText(survivorCatalogManifest.sourceCandidateCatalogSha256)
  if (gatedSourceSha256 && survivorSourceSha256 && gatedSourceSha256 !== survivorSourceSha256) {
    throw new Error(
      `survivor source catalog hash mismatch: survivor=${survivorSourceSha256} gatedSource=${gatedSourceSha256}`,
    )
  }
}

export const assertTp12Year2hitOosPreflight = async ({
  contractPath = "",
  dataReadinessSummaryPath = "",
  asofSurvivorshipSummaryPath = "",
  labelManifestPath = "",
  tokenDictionaryManifestPath = "",
  eventRowManifestPath = "",
  qualityGateSummaryPath = "",
  survivorCatalogManifestPath = "",
  trainGateSummaryPath,
  gatedCatalogPath,
  gatedCatalogManifestPath,
  expectedGateSha256 = "",
  expectedCatalogSha256 = "",
  oosFrom = "",
  oosTo = "",
  failOnZeroSurvivors = true,
  requireExtendedManifests = false,
} = {}) => {
  if (!toText(trainGateSummaryPath)) throw new Error("trainGateSummaryPath is required")
  if (!toText(gatedCatalogPath)) throw new Error("gatedCatalogPath is required")
  if (!toText(gatedCatalogManifestPath)) throw new Error("gatedCatalogManifestPath is required")
  const contract = toText(contractPath) ? (await readRequiredJson(contractPath, "contract")).payload : null
  const qualityGate = toText(qualityGateSummaryPath)
    ? (await readRequiredJson(qualityGateSummaryPath, "quality gate summary")).payload
    : null
  const extendedRequired =
    parseBoolFlag(requireExtendedManifests, false) ||
    contract?.oosPreflight?.blockedWithoutExtendedManifests === true
  const dataReadinessRequired = contract?.oosPreflight?.blockedWithoutDataReadiness === true
  const asofSurvivorshipRequired = contract?.oosPreflight?.blockedWithoutAsofSurvivorship === true
  const dataReadinessRef = await readOptionalJson(dataReadinessSummaryPath, "data readiness summary", {
    required: dataReadinessRequired,
  })
  const asofSurvivorshipRef = await readOptionalJson(asofSurvivorshipSummaryPath, "as-of survivorship summary", {
    required: asofSurvivorshipRequired,
  })
  const labelManifestRef = await readOptionalJson(labelManifestPath, "label manifest", {
    required: extendedRequired,
  })
  const tokenDictionaryManifestRef = await readOptionalJson(
    tokenDictionaryManifestPath,
    "token dictionary manifest",
    { required: extendedRequired },
  )
  const eventRowManifestRef = await readOptionalJson(eventRowManifestPath, "event row manifest", {
    required: extendedRequired,
  })
  const survivorCatalogManifestRef = await readOptionalJson(
    survivorCatalogManifestPath,
    "survivor catalog manifest",
    { required: extendedRequired },
  )
  assertStatusPassed({
    payload: dataReadinessRef.payload,
    label: "data readiness summary",
    optional: !dataReadinessRequired && !dataReadinessRef.payload,
  })
  assertStatusPassed({
    payload: asofSurvivorshipRef.payload,
    label: "as-of survivorship summary",
    optional: !asofSurvivorshipRequired && !asofSurvivorshipRef.payload,
  })
  if (dataReadinessRef.payload) assertNoFailures({ payload: dataReadinessRef.payload, label: "data readiness summary" })
  if (asofSurvivorshipRef.payload) assertNoFailures({ payload: asofSurvivorshipRef.payload, label: "as-of survivorship summary" })
  assertStatusPassed({
    payload: qualityGate,
    label: "quality gate summary",
    optional: !toText(qualityGateSummaryPath),
  })
  assertStatusPassed({
    payload: labelManifestRef.payload,
    label: "label manifest",
    optional: !labelManifestRef.payload,
  })
  assertStatusPassed({
    payload: tokenDictionaryManifestRef.payload,
    label: "token dictionary manifest",
    optional: !tokenDictionaryManifestRef.payload,
  })
  assertStatusPassed({
    payload: eventRowManifestRef.payload,
    label: "event row manifest",
    optional: !eventRowManifestRef.payload,
  })
  assertStatusPassed({
    payload: survivorCatalogManifestRef.payload,
    label: "survivor catalog manifest",
    optional: !survivorCatalogManifestRef.payload,
  })
  const { resolved: gatePath, payload: trainGateSummary } = await readRequiredJson(
    trainGateSummaryPath,
    "train gate summary",
  )
  assertStatusPassed({ payload: trainGateSummary, label: "train gate summary" })
  const survivorPatternIds = Array.isArray(trainGateSummary.survivorPatternIds)
    ? trainGateSummary.survivorPatternIds.map((value) => toText(value)).filter(Boolean).sort()
    : (Array.isArray(trainGateSummary.survivors) ? trainGateSummary.survivors : [])
        .map((row) => toText(row?.patternId))
        .filter(Boolean)
        .sort()
  if (failOnZeroSurvivors && survivorPatternIds.length < 1) {
    throw new Error("train gate survivor count is zero")
  }
  const survivorPatternIdsSha256 = sha256TextLines(survivorPatternIds)
  if (toText(trainGateSummary.survivorPatternIdsSha256) !== survivorPatternIdsSha256) {
    throw new Error(
      `train gate survivor hash mismatch: summary=${toText(trainGateSummary.survivorPatternIdsSha256)} computed=${survivorPatternIdsSha256}`,
    )
  }
  if (toText(expectedGateSha256) && toText(expectedGateSha256) !== survivorPatternIdsSha256) {
    throw new Error(`expected gate sha256 mismatch: expected=${expectedGateSha256} actual=${survivorPatternIdsSha256}`)
  }
  if (qualityGate) {
    const qualityPassedSurvivorCount = Number(qualityGate.passedSurvivorCount ?? 0)
    if (qualityPassedSurvivorCount < 1) {
      throw new Error("quality gate summary has zero passed survivors")
    }
    if (qualityPassedSurvivorCount !== survivorPatternIds.length) {
      throw new Error(
        `quality gate passed survivor count mismatch: quality=${qualityPassedSurvivorCount} gate=${survivorPatternIds.length}`,
      )
    }
    const qualityGateSha256 = toText(qualityGate.passedPatternIdsSha256 || qualityGate.survivorPatternIdsSha256)
    if (!qualityGateSha256) {
      throw new Error("quality gate summary is missing passedPatternIdsSha256")
    }
    if (qualityGateSha256 !== survivorPatternIdsSha256) {
      throw new Error(`quality gate passed survivor hash mismatch: quality=${qualityGateSha256} gate=${survivorPatternIdsSha256}`)
    }
  }
  const { resolved: manifestPath, payload: manifest } = await readRequiredJson(
    gatedCatalogManifestPath,
    "gated catalog manifest",
  )
  assertStatusPassed({ payload: manifest, label: "gated catalog manifest" })
  const catalogPath = path.resolve(gatedCatalogPath)
  if (!pathExists(catalogPath)) throw new Error(`gated catalog not found: ${catalogPath}`)
  const catalogSha256 = await computeFileSha256(catalogPath)
  if (toText(manifest.outCatalogSha256) !== catalogSha256) {
    throw new Error(`gated catalog sha256 mismatch: manifest=${toText(manifest.outCatalogSha256)} actual=${catalogSha256}`)
  }
  if (toText(expectedCatalogSha256) && toText(expectedCatalogSha256) !== catalogSha256) {
    throw new Error(`expected catalog sha256 mismatch: expected=${expectedCatalogSha256} actual=${catalogSha256}`)
  }
  if (toText(manifest.survivorPatternIdsSha256) !== survivorPatternIdsSha256) {
    throw new Error(
      `gated catalog survivor hash mismatch: manifest=${toText(manifest.survivorPatternIdsSha256)} gate=${survivorPatternIdsSha256}`,
    )
  }
  if (Number(manifest.survivorCount) !== survivorPatternIds.length) {
    throw new Error(`gated catalog survivor count mismatch: manifest=${manifest.survivorCount} gate=${survivorPatternIds.length}`)
  }
  assertExtendedArtifactChain({
    labelManifest: labelManifestRef.payload,
    tokenDictionaryManifest: tokenDictionaryManifestRef.payload,
    eventRowManifest: eventRowManifestRef.payload,
    gatedCatalogManifest: manifest,
  })
  await assertSurvivorCatalogManifest({
    survivorCatalogManifest: survivorCatalogManifestRef.payload,
    survivorPatternIds,
    survivorPatternIdsSha256,
    gatedCatalogManifest: manifest,
  })
  const contractGate = contract ? deriveTp12Year2hitGateOptionsFromContract(contract) : null
  const contractOos = contract?.oosDateRange ?? null
  assertNoTrainOosOverlap({
    trainDateRange: trainGateSummary.trainDateRange ?? {
      from: contractGate?.trainDateFrom,
      to: contractGate?.trainDateTo,
    },
    oosDateRange: {
      from: toText(oosFrom) || contractOos?.from,
      to: toText(oosTo) || contractOos?.to,
    },
  })
  if (contract?.oosPreflight?.blockedWithoutTrainGate !== true) {
    if (contract) throw new Error("contract does not explicitly require blockedWithoutTrainGate=true")
  }
  return {
    kind: "tp12_year2hit_oos_preflight_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dataReadinessSummaryPath: dataReadinessRef.resolved,
    dataReadinessSummarySha256: dataReadinessRef.sha256,
    asofSurvivorshipSummaryPath: asofSurvivorshipRef.resolved,
    asofSurvivorshipSummarySha256: asofSurvivorshipRef.sha256,
    labelManifestPath: labelManifestRef.resolved,
    labelManifestSha256: labelManifestRef.sha256,
    tokenDictionaryManifestPath: tokenDictionaryManifestRef.resolved,
    tokenDictionaryManifestSha256: tokenDictionaryManifestRef.sha256,
    eventRowManifestPath: eventRowManifestRef.resolved,
    eventRowManifestSha256: eventRowManifestRef.sha256,
    qualityGateSummaryPath: qualityGateSummaryPath ? path.resolve(qualityGateSummaryPath) : null,
    survivorCatalogManifestPath: survivorCatalogManifestRef.resolved,
    survivorCatalogManifestSha256: survivorCatalogManifestRef.sha256,
    trainGateSummaryPath: gatePath,
    trainGateSummarySha256: await computeFileSha256(gatePath),
    gatedCatalogPath: catalogPath,
    gatedCatalogSha256: catalogSha256,
    gatedCatalogManifestPath: manifestPath,
    gatedCatalogManifestSha256: await computeFileSha256(manifestPath),
    survivorCount: survivorPatternIds.length,
    qualityPassedSurvivorCount: qualityGate ? Number(qualityGate.passedSurvivorCount ?? 0) : null,
    qualityPassedPatternIdsSha256: qualityGate ? toText(qualityGate.passedPatternIdsSha256 || qualityGate.survivorPatternIdsSha256) : null,
    survivorPatternIdsSha256,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const outPath = toText(getFlag(flags, "out", ""))
  const summary = await assertTp12Year2hitOosPreflight({
    contractPath: toText(getFlag(flags, "contract-path", "")) ? path.resolve(cwd, toText(getFlag(flags, "contract-path", ""))) : "",
    dataReadinessSummaryPath: toText(getFlag(flags, "data-readiness-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "data-readiness-summary", "")))
      : "",
    asofSurvivorshipSummaryPath: toText(getFlag(flags, "asof-survivorship-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "asof-survivorship-summary", "")))
      : "",
    labelManifestPath: toText(getFlag(flags, "label-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "label-manifest", "")))
      : "",
    tokenDictionaryManifestPath: toText(getFlag(flags, "token-dictionary-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "token-dictionary-manifest", "")))
      : "",
    eventRowManifestPath: toText(getFlag(flags, "event-row-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "event-row-manifest", "")))
      : "",
    qualityGateSummaryPath: toText(getFlag(flags, "quality-gate-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "quality-gate-summary", "")))
      : "",
    survivorCatalogManifestPath: toText(getFlag(flags, "survivor-catalog-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "survivor-catalog-manifest", "")))
      : "",
    trainGateSummaryPath: path.resolve(cwd, toText(getFlag(flags, "train-gate-summary", ""))),
    gatedCatalogPath: path.resolve(cwd, toText(getFlag(flags, "gated-catalog", ""))),
    gatedCatalogManifestPath: path.resolve(cwd, toText(getFlag(flags, "gated-catalog-manifest", ""))),
    expectedGateSha256: toText(getFlag(flags, "expected-gate-sha256", "")),
    expectedCatalogSha256: toText(getFlag(flags, "expected-catalog-sha256", "")),
    oosFrom: toText(getFlag(flags, "oos-from", "")),
    oosTo: toText(getFlag(flags, "oos-to", "")),
    failOnZeroSurvivors: parseBoolFlag(getFlag(flags, "fail-on-zero-survivors", true), true),
    requireExtendedManifests: parseBoolFlag(getFlag(flags, "require-extended-manifests", false), false),
  })
  if (outPath) {
    await fs.mkdir(path.dirname(path.resolve(cwd, outPath)), { recursive: true })
    await fs.writeFile(path.resolve(cwd, outPath), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  }
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
