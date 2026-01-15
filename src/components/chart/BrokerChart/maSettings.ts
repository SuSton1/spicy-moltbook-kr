export type MaLineSetting = {
  id: string
  enabled: boolean
  period: number
}

export type MaSettings = {
  lines: MaLineSetting[]
}

export const DEFAULT_MA_SETTINGS: MaSettings = {
  lines: [
    { id: "ma1", enabled: true, period: 5 },
    { id: "ma2", enabled: true, period: 10 },
    { id: "ma3", enabled: true, period: 20 },
    { id: "ma4", enabled: true, period: 60 },
    { id: "ma5", enabled: true, period: 120 },
  ],
}

const clampPeriod = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(500, Math.max(1, Math.trunc(value)))
}

export const normalizeMaSettings = (value: unknown): MaSettings => {
  if (!value || typeof value !== "object") {
    return DEFAULT_MA_SETTINGS
  }
  const maybe = value as { lines?: unknown }
  const rawLines = Array.isArray(maybe.lines) ? maybe.lines : []
  const lines: MaLineSetting[] = rawLines
    .map((line, index) => {
      const entry =
        line && typeof line === "object"
          ? (line as Record<string, unknown>)
          : {}
      const idRaw = entry.id
      const id = typeof idRaw === "string" && idRaw ? idRaw : `ma${index + 1}`
      const enabled = Boolean(entry.enabled)
      const periodRaw = entry.period
      const period =
        typeof periodRaw === "number"
          ? periodRaw
          : typeof periodRaw === "string"
            ? Number(periodRaw)
            : NaN
      return { id, enabled, period: clampPeriod(period) }
    })
    .slice(0, DEFAULT_MA_SETTINGS.lines.length)

  while (lines.length < DEFAULT_MA_SETTINGS.lines.length) {
    const fallback = DEFAULT_MA_SETTINGS.lines[lines.length]
    lines.push({ ...fallback })
  }

  return { lines }
}

export const updateMaLine = (
  settings: MaSettings,
  index: number,
  patch: Partial<Pick<MaLineSetting, "enabled" | "period">>,
): MaSettings => {
  const next = normalizeMaSettings(settings)
  if (index < 0 || index >= next.lines.length) {
    return next
  }
  const current = next.lines[index]
  const period =
    patch.period === undefined ? current.period : clampPeriod(patch.period)
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled
  const lines = next.lines.map((line, idx) =>
    idx === index ? { ...line, enabled, period } : line,
  )
  return { lines }
}
