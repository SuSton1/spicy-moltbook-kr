import path from "node:path"

import {
  buildEnabledRecentImpulseLanes,
  buildRecentImpulseUniverseId,
  MAX_RECENT_IMPULSE_LOOKBACK_DAYS,
} from "./perfect_prototype_multiline_contract.mjs"
import { readJson, writeJson } from "./io.mjs"
import {
  DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH,
  loadTp12NoStopRollingResearchContract,
  TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND,
} from "./tp12_no_stop_rolling_contract.mjs"

export const TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_KIND = "tp12_no_stop_lookback_ladder_contract_v1"
export const DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH = "meta/tp12_no_stop_lookback_ladder_contract.json"
export const TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE = "sparse"
export const TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL = "dense_fill"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertPositiveInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

export const normalizeTp12NoStopLookbackCandidateId = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTp12NoStopLookbackCandidateSlug = (candidateId) =>
  normalizeTp12NoStopLookbackCandidateId(candidateId) || "candidate"

const validateCandidate = (candidate, index) => {
  const candidateId = assertNonEmpty(candidate?.candidateId, `lookbackCandidates[${index}].candidateId`)
  const stage = assertNonEmpty(candidate?.stage, `lookbackCandidates[${index}].stage`)
  if (stage !== TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE && stage !== TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL) {
    throw new Error(`Unsupported lookback candidate stage=${stage} for candidateId=${candidateId}`)
  }
  const lookbackTradingDays = assertPositiveInteger(
    candidate?.lookbackTradingDays,
    `lookbackCandidates[${index}].lookbackTradingDays`,
  )
  if (lookbackTradingDays > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    throw new Error(
      `lookbackCandidates[${index}].lookbackTradingDays exceeds current ceiling ${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}: ${lookbackTradingDays}`,
    )
  }
  const discoveryUniverseId = buildRecentImpulseUniverseId(lookbackTradingDays)
  const expectedStepALaneSet = buildEnabledRecentImpulseLanes(lookbackTradingDays)
  const requestedStepALaneSet = uniqueSorted(candidate?.stepALaneSet)
  const requestedDiscoveryUniverseId = toText(candidate?.discoveryUniverseId)
  if (requestedDiscoveryUniverseId && requestedDiscoveryUniverseId !== discoveryUniverseId) {
    throw new Error(
      `lookbackCandidates[${index}].discoveryUniverseId must be ${discoveryUniverseId}, got ${requestedDiscoveryUniverseId}`,
    )
  }
  if (requestedStepALaneSet.length > 0) {
    const expectedSignature = expectedStepALaneSet.join(",")
    const requestedSignature = requestedStepALaneSet.join(",")
    if (expectedSignature !== requestedSignature) {
      throw new Error(
        `lookbackCandidates[${index}].stepALaneSet mismatch for candidateId=${candidateId}: expected=${expectedSignature} actual=${requestedSignature}`,
      )
    }
  }
  return {
    candidateId,
    stage,
    lookbackTradingDays,
    discoveryUniverseId,
    stepALaneSet: expectedStepALaneSet,
    ordinal: index,
  }
}

const validateCandidateSelection = ({ lookbackCandidates, rawSelection = {} } = {}) => {
  const allCandidates = Array.isArray(lookbackCandidates) ? lookbackCandidates : []
  const byId = new Map(allCandidates.map((candidate) => [normalizeTp12NoStopLookbackCandidateId(candidate.candidateId), candidate]))
  const sparseDefault = allCandidates
    .filter((candidate) => candidate.stage === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE)
    .map((candidate) => candidate.candidateId)
  const denseDefault = allCandidates
    .filter((candidate) => candidate.stage === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL)
    .map((candidate) => candidate.candidateId)
  const sparseCandidateIds = uniqueSorted(rawSelection?.sparseCandidateIds?.length ? rawSelection.sparseCandidateIds : sparseDefault)
  const denseFillCandidateIds = uniqueSorted(
    rawSelection?.denseFillCandidateIds?.length ? rawSelection.denseFillCandidateIds : denseDefault,
  )
  const assertStage = (candidateIds, stageLabel, expectedStage) => {
    for (const candidateId of candidateIds) {
      const candidate = byId.get(normalizeTp12NoStopLookbackCandidateId(candidateId))
      if (!candidate) {
        throw new Error(`candidateSelection.${stageLabel} references unknown candidateId=${candidateId}`)
      }
      if (candidate.stage !== expectedStage) {
        throw new Error(
          `candidateSelection.${stageLabel} references candidateId=${candidateId} with stage=${candidate.stage}, expected=${expectedStage}`,
        )
      }
    }
  }
  assertStage(sparseCandidateIds, "sparseCandidateIds", TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE)
  assertStage(denseFillCandidateIds, "denseFillCandidateIds", TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL)
  return {
    sparseCandidateIds,
    denseFillCandidateIds,
  }
}

export const loadTp12NoStopLookbackLadderContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop lookback ladder contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop lookback ladder contract kind=${kind}`)
  }
  const baseRollingContractPath = toText(raw.baseRollingContractPath) || DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH
  const baseRollingContract = await loadTp12NoStopRollingResearchContract({
    contractPath: baseRollingContractPath,
    cwd,
  })
  if (baseRollingContract.kind !== TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported base rolling contract kind=${baseRollingContract.kind}`)
  }
  const scopeId = assertNonEmpty(raw.scopeId || baseRollingContract.scopeId, "contract.scopeId")
  if (scopeId !== toText(baseRollingContract.scopeId)) {
    throw new Error(`lookback ladder scopeId must match base rolling scopeId=${baseRollingContract.scopeId}`)
  }
  const lookbackCandidates = (Array.isArray(raw?.lookbackCandidates) ? raw.lookbackCandidates : []).map((candidate, index) =>
    validateCandidate(candidate, index),
  )
  if (lookbackCandidates.length < 1) {
    throw new Error("lookbackCandidates is required")
  }
  const byId = new Map()
  for (const candidate of lookbackCandidates) {
    const normalizedId = normalizeTp12NoStopLookbackCandidateId(candidate.candidateId)
    if (byId.has(normalizedId)) {
      throw new Error(`Duplicate lookback candidateId=${candidate.candidateId}`)
    }
    byId.set(normalizedId, candidate)
  }
  const candidateSelection = validateCandidateSelection({
    lookbackCandidates,
    rawSelection: raw?.candidateSelection ?? {},
  })
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    scopeId,
    baseRollingContractPath: baseRollingContract.contractPath,
    baseRollingContract,
    lookbackCandidates,
    candidateSelection,
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}

export const resolveTp12NoStopLookbackCandidate = ({ ladderContract, candidateId } = {}) => {
  const candidates = Array.isArray(ladderContract?.lookbackCandidates) ? ladderContract.lookbackCandidates : []
  const normalizedId = normalizeTp12NoStopLookbackCandidateId(candidateId)
  const candidate = candidates.find(
    (entry) => normalizeTp12NoStopLookbackCandidateId(entry?.candidateId) === normalizedId,
  )
  if (!candidate) {
    throw new Error(`Unknown TP12 no-stop lookback candidateId=${candidateId}`)
  }
  return candidate
}

export const resolveTp12NoStopLookbackCandidates = ({
  ladderContract,
  candidateGroup = "all",
  candidateIds = [],
} = {}) => {
  const candidates = Array.isArray(ladderContract?.lookbackCandidates) ? ladderContract.lookbackCandidates : []
  const requestedIds = uniqueSorted(candidateIds).map((value) => normalizeTp12NoStopLookbackCandidateId(value))
  if (requestedIds.length > 0) {
    const byId = new Map(
      candidates.map((candidate) => [normalizeTp12NoStopLookbackCandidateId(candidate.candidateId), candidate]),
    )
    const resolved = requestedIds.map((candidateId) => byId.get(candidateId)).filter(Boolean)
    if (resolved.length !== requestedIds.length) {
      const missing = requestedIds.filter((candidateId) => !byId.has(candidateId))
      throw new Error(`Unknown lookback candidate ids: ${missing.join(", ")}`)
    }
    return resolved.sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  const normalizedGroup = toText(candidateGroup).toLowerCase() || "all"
  if (normalizedGroup === "all") {
    return [...candidates].sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  if (normalizedGroup === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_SPARSE) {
    const ids = new Set(
      (Array.isArray(ladderContract?.candidateSelection?.sparseCandidateIds)
        ? ladderContract.candidateSelection.sparseCandidateIds
        : []
      ).map((candidateId) => normalizeTp12NoStopLookbackCandidateId(candidateId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoStopLookbackCandidateId(candidate.candidateId)))
  }
  if (normalizedGroup === TP12_NO_STOP_LOOKBACK_CANDIDATE_STAGE_DENSE_FILL || normalizedGroup === "dense") {
    const ids = new Set(
      (Array.isArray(ladderContract?.candidateSelection?.denseFillCandidateIds)
        ? ladderContract.candidateSelection.denseFillCandidateIds
        : []
      ).map((candidateId) => normalizeTp12NoStopLookbackCandidateId(candidateId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoStopLookbackCandidateId(candidate.candidateId)))
  }
  throw new Error(`Unsupported TP12 no-stop lookback candidateGroup=${candidateGroup}`)
}

export const buildTp12NoStopLookbackCandidateRollingContract = ({
  ladderContract,
  candidateId,
} = {}) => {
  const candidate = resolveTp12NoStopLookbackCandidate({
    ladderContract,
    candidateId,
  })
  const baseRolling = ladderContract?.baseRollingContract ?? {}
  return {
    kind: TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND,
    contractId: `${toText(ladderContract?.contractId)}_${buildTp12NoStopLookbackCandidateSlug(candidate.candidateId)}`,
    updatedAt: toText(ladderContract?.updatedAt),
    scopeId: toText(ladderContract?.scopeId),
    lookbackLadderContext: {
      kind: "tp12_no_stop_lookback_candidate_context_v1",
      contractId: toText(ladderContract?.contractId),
      selectedCandidate: {
        candidateId: candidate.candidateId,
        stage: candidate.stage,
        ordinal: Number(candidate?.ordinal ?? 0),
        lookbackTradingDays: candidate.lookbackTradingDays,
        discoveryUniverseId: candidate.discoveryUniverseId,
        stepALaneSet: [...candidate.stepALaneSet],
      },
    },
    decisionWindow: { ...(baseRolling?.decisionWindow ?? {}) },
    inputContract: {
      discoveryUniverseId: candidate.discoveryUniverseId,
      requestedLookbackTradingDays: candidate.lookbackTradingDays,
      stepALaneSet: [...candidate.stepALaneSet],
      allowlistPolicy: toText(baseRolling?.inputContract?.allowlistPolicy),
      commonSupportPolicy: toText(baseRolling?.inputContract?.commonSupportPolicy),
    },
    labelContract: JSON.parse(JSON.stringify(baseRolling?.labelContract ?? {})),
    searchContract: {
      ...(baseRolling?.searchContract ?? {}),
      configPath: toText(baseRolling?.searchContract?.configPath),
    },
    screenAcceptance: JSON.parse(JSON.stringify(baseRolling?.screenAcceptance ?? {})),
    windows: JSON.parse(JSON.stringify(baseRolling?.windows ?? [])),
    hardStops: [
      `Derived lookback-ladder rolling contract for candidateId=${candidate.candidateId}`,
      ...((Array.isArray(ladderContract?.hardStops) ? ladderContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(ladderContract?.contractPath)}`,
      `candidateId=${candidate.candidateId}`,
      `lookbackTradingDays=${candidate.lookbackTradingDays}`,
      `candidateStage=${candidate.stage}`,
      `discoveryUniverseId=${candidate.discoveryUniverseId}`,
      `baseRollingContractPath=${toText(ladderContract?.baseRollingContractPath)}`,
    ],
  }
}

export const writeTp12NoStopLookbackCandidateRollingContract = async ({
  ladderContract,
  candidateId,
  outPath,
} = {}) => {
  const payload = buildTp12NoStopLookbackCandidateRollingContract({
    ladderContract,
    candidateId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12NoStopLookbackCandidateRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
