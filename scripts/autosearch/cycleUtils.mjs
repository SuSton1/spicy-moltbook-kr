import {
  normalizeDateKey,
  shiftDateKey,
  shiftDateKeyByMonths,
  firstDayOfMonth,
} from "../ai-date-range.lib.mjs"
import { toWeekKeyKst } from "../lib/weekKey.mjs"

const compareKey = (a, b) => String(a).localeCompare(String(b))

export const normalizeCalendar = (calendar, asOfDateKey) => {
  const asOf = normalizeDateKey(asOfDateKey)
  const list = Array.isArray(calendar) ? calendar : []
  return list
    .map((key) => normalizeDateKey(key))
    .filter((key) => key && (!asOf || key <= asOf))
    .sort(compareKey)
}

export const snapToTradingDay = ({ calendar, dateKey }) => {
  const normalized = normalizeDateKey(dateKey)
  if (!normalized) {
    return null
  }
  const list = normalizeCalendar(calendar, normalized)
  if (!list.length) {
    return normalized
  }
  if (list.includes(normalized)) {
    return normalized
  }
  const prior = list.filter((key) => key < normalized)
  return prior.length ? prior[prior.length - 1] : list[0]
}

export const listWeekKeysForCalendar = ({ calendar, asOfDateKey }) => {
  const clean = normalizeCalendar(calendar, asOfDateKey)
  const out = []
  let last = null
  for (const dateKey of clean) {
    const weekKey = toWeekKeyKst(dateKey)
    if (!weekKey || weekKey === "unknown") {
      continue
    }
    if (weekKey !== last) {
      out.push(weekKey)
      last = weekKey
    }
  }
  return out
}

export const resolveWeekWindowFromCalendar = ({
  calendar,
  asOfDateKey,
  weekCount,
  offsetWeeks = 0,
}) => {
  const clean = normalizeCalendar(calendar, asOfDateKey)
  const weeks = listWeekKeysForCalendar({ calendar: clean, asOfDateKey })
  const count = Math.max(1, Math.floor(weekCount ?? 1))
  const offset = Math.max(0, Math.floor(offsetWeeks ?? 0))
  const end = weeks.length - offset
  const start = end - count
  if (start < 0 || end <= 0 || start >= end) {
    return null
  }
  const selected = weeks.slice(start, end)
  const weekSet = new Set(selected)
  const windowDates = clean.filter((key) => weekSet.has(toWeekKeyKst(key)))
  if (!windowDates.length) {
    return null
  }
  return {
    weekKeys: selected,
    fromDateKey: windowDates[0],
    toDateKey: windowDates[windowDates.length - 1],
  }
}

export const resolveCycleWindows = ({
  calendar,
  asOfDateKey,
  weekCount = 16,
  trainMonths = 62,
}) => {
  const asOfTrading = snapToTradingDay({ calendar, dateKey: asOfDateKey })
  if (!asOfTrading) {
    return null
  }
  const lockbox = resolveWeekWindowFromCalendar({
    calendar,
    asOfDateKey: asOfTrading,
    weekCount,
    offsetWeeks: 0,
  })
  const validation = resolveWeekWindowFromCalendar({
    calendar,
    asOfDateKey: asOfTrading,
    weekCount,
    offsetWeeks: weekCount,
  })
  if (!lockbox || !validation) {
    return null
  }
  const validationStart = validation.fromDateKey
  const trainTo = shiftDateKey(validationStart, -1) ?? validationStart
  const trainFromMonth = firstDayOfMonth(
    shiftDateKeyByMonths(validationStart, -trainMonths),
  )
  const trainFrom = trainFromMonth ?? trainTo
  return {
    asOfTrading,
    lockbox,
    validation,
    trainFromDateKey: trainFrom,
    trainToDateKey: trainTo,
  }
}

export const buildNextCyclePlan = ({ lockboxWindow, calendar }) => {
  if (!lockboxWindow?.fromDateKey || !lockboxWindow?.toDateKey) {
    return null
  }
  const clean = normalizeCalendar(calendar, lockboxWindow.toDateKey)
  const weekKeyForDate = (dateKey) => toWeekKeyKst(dateKey)
  const weekKeys = listWeekKeysForCalendar({
    calendar: clean,
    asOfDateKey: lockboxWindow.toDateKey,
  })
  const lockboxWeekKey = weekKeyForDate(lockboxWindow.toDateKey)
  const lockboxWeekIdx = weekKeys.findIndex((key) => key === lockboxWeekKey)
  const nextValidation = {
    fromDateKey: lockboxWindow.fromDateKey,
    toDateKey: lockboxWindow.toDateKey,
  }
  const nextWeekKeys =
    lockboxWeekIdx >= 0
      ? weekKeys.slice(lockboxWeekIdx + 1, lockboxWeekIdx + 1 + 16)
      : []
  const nextWeekSet = new Set(nextWeekKeys)
  const nextDates = clean.filter((key) => nextWeekSet.has(toWeekKeyKst(key)))
  const nextLockboxStart = nextDates[0] ?? lockboxWindow.toDateKey
  const nextLockboxEnd =
    nextDates[nextDates.length - 1] ?? lockboxWindow.toDateKey
  const hasFuture = nextDates.length >= 16
  return {
    nextValidation,
    nextLockbox: {
      fromDateKey: nextLockboxStart,
      toDateKey: nextLockboxEnd,
    },
    estimated: !hasFuture,
  }
}

export const detectFreezeViolation = ({ status, previousHash, nextHash }) => {
  if (status !== "LOCKBOX_IN_PROGRESS") {
    return false
  }
  if (!previousHash || !nextHash) {
    return false
  }
  return previousHash !== nextHash
}

export const buildWeekKeysForRange = ({
  calendar,
  startDateKey,
  endDateKey,
}) => {
  const start = normalizeDateKey(startDateKey)
  const end = normalizeDateKey(endDateKey)
  if (!start || !end) {
    return []
  }
  const clean = normalizeCalendar(calendar, end)
  const weekKeys = []
  let last = null
  for (const key of clean) {
    if (key < start || key > end) {
      continue
    }
    const weekKey = toWeekKeyKst(key)
    if (!weekKey || weekKey === "unknown") {
      continue
    }
    if (weekKey !== last) {
      weekKeys.push(weekKey)
      last = weekKey
    }
  }
  return weekKeys
}

export const detectWindowDrift = ({ status, stored, computed }) => {
  if (status !== "LOCKBOX_IN_PROGRESS") {
    return false
  }
  if (!stored || !computed) {
    return false
  }
  const fields = [
    [
      "lockbox.fromDateKey",
      stored.lockbox?.fromDateKey,
      computed.lockbox?.fromDateKey,
    ],
    [
      "lockbox.toDateKey",
      stored.lockbox?.toDateKey,
      computed.lockbox?.toDateKey,
    ],
    [
      "validation.fromDateKey",
      stored.validation?.fromDateKey,
      computed.validation?.fromDateKey,
    ],
    [
      "validation.toDateKey",
      stored.validation?.toDateKey,
      computed.validation?.toDateKey,
    ],
    ["trainFromDateKey", stored.trainFromDateKey, computed.trainFromDateKey],
    ["trainToDateKey", stored.trainToDateKey, computed.trainToDateKey],
  ]
  return fields.some((entry) => entry[1] && entry[2] && entry[1] !== entry[2])
}

export const buildNextCyclePlanPayload = ({
  nextPlan,
  nextCandidates,
  nextChosenHash,
  nextAttemptLogSummary,
  nextBlocked,
  nextLeaderboard,
}) => {
  if (!nextPlan) {
    return null
  }
  const blockedReason = String(nextBlocked?.reason ?? "")
    .trim()
    .toUpperCase()
  const blockedStatus =
    blockedReason === "MOONSHOT_GATE_FAILED"
      ? "MOONSHOT_GATE_FAILED"
      : "BLOCKED_BY_DATA"
  return {
    validationStartDateKey: nextPlan.nextValidation.fromDateKey,
    validationEndDateKey: nextPlan.nextValidation.toDateKey,
    lockboxStartDateKey: nextPlan.nextLockbox.fromDateKey,
    lockboxEndDateKey: nextPlan.nextLockbox.toDateKey,
    estimated: nextPlan.estimated,
    nextStatus: nextBlocked ? blockedStatus : "WAITING_FOR_MORE_DATA",
    nextChosenCandidates: nextBlocked ? [] : nextCandidates,
    nextChosenHash,
    nextAttemptLogSummary,
    nextArtifactLinks: nextLeaderboard
      ? [
          { type: "validation_leaderboard", path: nextLeaderboard.jsonPath },
          { type: "validation_leaderboard_md", path: nextLeaderboard.mdPath },
        ]
      : [],
    blockedReason: nextBlocked?.reason ?? null,
    blockedHintCommand: nextBlocked?.hintCommand ?? null,
  }
}
