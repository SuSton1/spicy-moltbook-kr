export const TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN = "screen"
export const TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM = "final_confirm"

const toText = (value) => String(value ?? "").trim()

export const normalizeTp12NoStopRollingWindowId = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTp12NoStopRollingWindowSlug = (windowId) => {
  const normalized = normalizeTp12NoStopRollingWindowId(windowId)
  return normalized || "window"
}

export const sortTp12NoStopRollingWindows = (windows = []) =>
  [...(Array.isArray(windows) ? windows : [])].sort((left, right) => {
    const leftOrdinal = Number(left?.ordinal)
    const rightOrdinal = Number(right?.ordinal)
    if (Number.isFinite(leftOrdinal) && Number.isFinite(rightOrdinal) && leftOrdinal !== rightOrdinal) {
      return leftOrdinal - rightOrdinal
    }
    const leftKind = toText(left?.kind)
    const rightKind = toText(right?.kind)
    if (leftKind !== rightKind) {
      if (leftKind === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) return 1
      if (rightKind === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) return -1
    }
    const leftTrain = toText(left?.trainDateFrom)
    const rightTrain = toText(right?.trainDateFrom)
    if (leftTrain !== rightTrain) return leftTrain.localeCompare(rightTrain)
    return toText(left?.windowId).localeCompare(toText(right?.windowId))
  })

export const selectTp12NoStopRollingWindows = ({
  windows = [],
  windowGroup = "all",
  windowIds = [],
} = {}) => {
  const safeWindows = sortTp12NoStopRollingWindows(windows)
  const requestedIds = Array.from(
    new Set((Array.isArray(windowIds) ? windowIds : []).map((value) => normalizeTp12NoStopRollingWindowId(value)).filter(Boolean)),
  )
  if (requestedIds.length > 0) {
    const byId = new Map(safeWindows.map((window) => [normalizeTp12NoStopRollingWindowId(window?.windowId), window]))
    const selected = requestedIds.map((id) => byId.get(id)).filter(Boolean)
    if (selected.length !== requestedIds.length) {
      const missing = requestedIds.filter((id) => !byId.has(id))
      throw new Error(`Unknown rolling window ids: ${missing.join(", ")}`)
    }
    return sortTp12NoStopRollingWindows(selected)
  }
  const normalizedGroup = toText(windowGroup).toLowerCase() || "all"
  if (normalizedGroup === "all") return safeWindows
  if (normalizedGroup === "screen") {
    return safeWindows.filter((window) => toText(window?.kind) === TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN)
  }
  if (normalizedGroup === "final" || normalizedGroup === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) {
    return safeWindows.filter((window) => toText(window?.kind) === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM)
  }
  throw new Error(`Unsupported rolling windowGroup=${windowGroup}`)
}
