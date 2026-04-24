const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

export const buildPerfectPrototypeFeatureBankManifest = ({ bankContract, sidecarStore } = {}) => {
  const partitions = Array.isArray(sidecarStore?.partitions) ? sidecarStore.partitions : []
  const featureKeys = uniqueStrings(sidecarStore?.featureKeys ?? [])
  return {
    bankId: bankContract?.bankId ?? null,
    bankVersion: bankContract?.bankVersion ?? null,
    targetUniverseId: bankContract?.targetUniverseId ?? null,
    contractHash: bankContract?.contractHash ?? null,
    partitionCount: partitions.length,
    partitions,
    derivedFeatureKeys: featureKeys,
    derivedFeatureCount: featureKeys.length,
    coverage: {
      dateCount: partitions.length,
      rowCount: partitions.reduce((sum, partition) => sum + Number(partition?.rowCount ?? 0), 0),
    },
  }
}
