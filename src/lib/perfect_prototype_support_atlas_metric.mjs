const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

import { scorePerfectPrototypeSupportAtlasAnchorCover } from "./perfect_prototype_support_atlas_anchor_metric.mjs"

const buildValueMap = (row, featureKeys) => {
  const out = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const value = num(row?.numericFeatureMap?.[featureKey])
    if (Number.isFinite(value)) out[featureKey] = value
  }
  return out
}

export const buildPerfectPrototypeSupportAtlasPrototype = ({
  rows = [],
  featureKeys = [],
} = {}) => {
  const prototypeValues = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    if (values.length < 1) continue
    prototypeValues[featureKey] = average(values)
  }
  return prototypeValues
}

export const buildPerfectPrototypeSupportAtlasFeatureWeights = ({
  positivePrototype = {},
  negativePrototype = {},
  featureKeys = [],
  featureScales = {},
} = {}) => {
  const out = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const positiveValue = num(positivePrototype?.[featureKey])
    const negativeValue = num(negativePrototype?.[featureKey])
    const scale = Math.max(0.05, num(featureScales?.[featureKey]) ?? 1)
    if (!Number.isFinite(positiveValue) || !Number.isFinite(negativeValue)) {
      out[featureKey] = 1
      continue
    }
    out[featureKey] = clamp(Math.abs(positiveValue - negativeValue) / scale + 0.25, 0.25, 4)
  }
  return out
}

export const scorePerfectPrototypeSupportAtlasPrototype = ({
  row,
  prototype = {},
  featureKeys = [],
  featureScales = {},
  featureWeights = {},
} = {}) => {
  const values = buildValueMap(row, featureKeys)
  const weightedDistances = []
  let totalWeight = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(values?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    const scale = Math.max(0.05, num(featureScales?.[featureKey]) ?? 1)
    const weight = Math.max(0.1, num(featureWeights?.[featureKey]) ?? 1)
    weightedDistances.push((Math.abs(rowValue - prototypeValue) / scale) * weight)
    totalWeight += weight
  }
  if (weightedDistances.length < 1 || totalWeight <= 0) return Number.POSITIVE_INFINITY
  return weightedDistances.reduce((sum, value) => sum + value, 0) / totalWeight
}

export const scorePerfectPrototypeSupportAtlasCell = ({
  row,
  cell,
  dataset,
} = {}) => {
  const featureKeys = Array.isArray(dataset?.featureKeys) ? dataset.featureKeys : []
  const featureScales = dataset?.featureScales ?? {}
  if (Array.isArray(cell?.positiveAnchors) && cell.positiveAnchors.length > 0) {
    const anchorEvaluation = scorePerfectPrototypeSupportAtlasAnchorCover({
      row,
      positiveAnchors: cell?.positiveAnchors ?? [],
      negativeBorderAnchors: cell?.negativeBorderAnchors ?? [],
      featureKeys,
      featureScales,
      featureWeights: cell?.featureWeights ?? {},
      kPositive: cell?.kPositive ?? 2,
    })
    return {
      cellId: cell?.cellId ?? null,
      posDistance: anchorEvaluation.positiveDistance,
      negDistance: anchorEvaluation.negativeDistance,
      margin: anchorEvaluation.margin,
      score: anchorEvaluation.score,
      positiveDistances: anchorEvaluation.positiveDistances,
      negativeDistances: anchorEvaluation.negativeDistances,
      positiveVoteCount: null,
      positiveNearestDistance: anchorEvaluation.positiveNearestDistance,
      positiveKDistance: anchorEvaluation.positiveKDistance,
    }
  }
  const posDistance = scorePerfectPrototypeSupportAtlasPrototype({
    row,
    prototype: cell?.positivePrototype ?? {},
    featureKeys,
    featureScales,
    featureWeights: cell?.featureWeights ?? {},
  })
  const negDistance = scorePerfectPrototypeSupportAtlasPrototype({
    row,
    prototype: cell?.negativePrototype ?? {},
    featureKeys,
    featureScales,
    featureWeights: cell?.featureWeights ?? {},
  })
  const margin =
    Number.isFinite(negDistance) && Number.isFinite(posDistance) ? negDistance - posDistance : null
  const score =
    Number.isFinite(num(margin)) && Number.isFinite(posDistance) ? margin - posDistance : null
  return {
    cellId: cell?.cellId ?? null,
    posDistance: Number.isFinite(posDistance) ? posDistance : null,
    negDistance: Number.isFinite(negDistance) ? negDistance : null,
    margin: Number.isFinite(num(margin)) ? margin : null,
    score: Number.isFinite(num(score)) ? score : null,
  }
}
