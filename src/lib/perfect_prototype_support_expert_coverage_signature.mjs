const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const uniqueNumbers = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => Number(value)).filter((value) => Number.isFinite(value))),
  ).sort((left, right) => left - right)

export const buildPerfectPrototypeSupportExpertCoverageSignature = ({
  expertId = null,
  groupId = null,
  trainSummary = {},
} = {}) => {
  const matchedDateKeys = uniqueStrings(trainSummary?.matchedDateKeys)
  const matchedMonthKeys = uniqueStrings(trainSummary?.matchedMonthKeys)
  const matchedFoldIds = uniqueNumbers(trainSummary?.matchedFoldIds)
  return {
    expertId,
    groupId,
    matchedDateKeys,
    matchedMonthKeys,
    matchedFoldIds,
    matchedDateSignature: matchedDateKeys.join("|"),
    matchedMonthSignature: matchedMonthKeys.join("|"),
    matchedFoldSignature: matchedFoldIds.join("|"),
  }
}

export const summarizePerfectPrototypeSupportExpertCoverageSignatures = ({ experts = [] } = {}) => {
  const signatures = (Array.isArray(experts) ? experts : []).map((expert) =>
    buildPerfectPrototypeSupportExpertCoverageSignature({
      expertId: expert?.expertId,
      groupId: expert?.groupId,
      trainSummary: expert?.trainSummary,
    }),
  )
  return {
    signatures,
    distinctMatchedDateSignatureCount: new Set(signatures.map((entry) => entry.matchedDateSignature).filter(Boolean))
      .size,
    distinctMatchedMonthSignatureCount: new Set(
      signatures.map((entry) => entry.matchedMonthSignature).filter(Boolean),
    ).size,
    distinctMatchedFoldSignatureCount: new Set(signatures.map((entry) => entry.matchedFoldSignature).filter(Boolean))
      .size,
  }
}
