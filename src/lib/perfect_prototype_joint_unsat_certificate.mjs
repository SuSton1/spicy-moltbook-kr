const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

export const incrementPerfectPrototypeJointUnsatReason = (
  reasonCounts,
  reason,
  count = 1,
) => {
  const key = String(reason ?? "").trim() || "unknown"
  reasonCounts[key] = Number(reasonCounts[key] ?? 0) + Number(count ?? 0)
}

export const recordPerfectPrototypeJointUnsatReasons = (
  reasonCounts,
  reasons = [],
) => {
  for (const reason of uniqueSorted(reasons)) {
    incrementPerfectPrototypeJointUnsatReason(reasonCounts, reason, 1)
  }
}

export const buildPerfectPrototypeJointUnsatCertificate = ({
  familyId = null,
  subgroupId = null,
  reasonCounts = {},
} = {}) => {
  const sortedReasons = Object.entries(reasonCounts ?? {}).sort(
    (left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0),
  )
  return {
    familyId: String(familyId ?? "").trim() || null,
    subgroupId: String(subgroupId ?? "").trim() || null,
    reasonCounts: { ...(reasonCounts ?? {}) },
    primaryReason: sortedReasons[0]?.[0] ?? "no_joint_feasible_rules",
  }
}

