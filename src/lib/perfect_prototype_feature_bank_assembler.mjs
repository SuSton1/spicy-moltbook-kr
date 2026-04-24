const mergeRowFeatures = ({ row, featureMap }) => {
  if (!row || !featureMap) return row
  return {
    ...row,
    numericFeatureMap: {
      ...(row?.numericFeatureMap ?? {}),
      ...featureMap,
    },
  }
}

const augmentCollection = ({ rows = [], rowFeatureMapByKey = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    return mergeRowFeatures({
      row,
      featureMap: rowFeatureMapByKey.get(rowKey) ?? null,
    })
  })

export const assemblePerfectPrototypeFeatureBankRows = ({ family, sidecarStore } = {}) => {
  const rowFeatureMapByKey = sidecarStore?.rowFeatureMapByKey instanceof Map ? sidecarStore.rowFeatureMapByKey : new Map()
  return {
    ...family,
    trainRows: augmentCollection({ rows: family?.trainRows, rowFeatureMapByKey }),
    gatedTrainRows: augmentCollection({ rows: family?.gatedTrainRows, rowFeatureMapByKey }),
    oosRows: augmentCollection({ rows: family?.oosRows, rowFeatureMapByKey }),
    supportCaseViews: augmentCollection({ rows: family?.supportCaseViews, rowFeatureMapByKey }),
    bridgePositiveRows: augmentCollection({ rows: family?.bridgePositiveRows, rowFeatureMapByKey }),
    supportNearHardNegativeRows: augmentCollection({ rows: family?.supportNearHardNegativeRows, rowFeatureMapByKey }),
    mechanismFeatureKeys: Array.isArray(sidecarStore?.featureKeys) ? sidecarStore.featureKeys : [],
    mechanismHypothesisCatalog: Array.isArray(sidecarStore?.hypothesisCatalog) ? sidecarStore.hypothesisCatalog : [],
    featureBankSidecarManifest: sidecarStore?.manifest ?? null,
    summary: {
      ...(family?.summary ?? {}),
      featureBankAssemblerReady: rowFeatureMapByKey.size > 0,
      mechanismFeatureCount: Number(sidecarStore?.featureKeys?.length ?? 0),
      mechanismHypothesisCount: Number(sidecarStore?.hypothesisCatalog?.length ?? 0),
    },
  }
}
