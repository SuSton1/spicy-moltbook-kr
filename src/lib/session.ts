export type MarketRegion = "KR" | "US"
export type SessionType = "KRX" | "NXT" | "US"

export type SessionClock = {
  hour: number
  minute: number
}

export type SessionWindow = {
  type: SessionType
  label: string
  timeZone: string
  open: SessionClock
  close: SessionClock
}

export const parseSessionClock = (
  value?: string | null,
): SessionClock | null => {
  if (!value) {
    return null
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }
  return { hour, minute }
}

export const SESSION_WINDOWS: Record<SessionType, SessionWindow> = {
  KRX: {
    type: "KRX",
    label: "KRX",
    timeZone: "Asia/Seoul",
    open: { hour: 9, minute: 0 },
    close: { hour: 15, minute: 30 },
  },
  NXT: {
    type: "NXT",
    label: "NXT",
    timeZone: "Asia/Seoul",
    open: { hour: 8, minute: 0 },
    close: { hour: 20, minute: 0 },
  },
  US: {
    type: "US",
    label: "US",
    timeZone: "America/New_York",
    open: { hour: 9, minute: 30 },
    close: { hour: 16, minute: 0 },
  },
}

export const resolveSessionWindow = (
  region: MarketRegion,
  sessionType?: SessionType,
) => {
  if (region === "US") {
    return SESSION_WINDOWS.US
  }
  if (sessionType === "NXT") {
    return SESSION_WINDOWS.NXT
  }
  return SESSION_WINDOWS.KRX
}

export const sessionDurationMinutes = (session: SessionWindow) => {
  const openMinutes = session.open.hour * 60 + session.open.minute
  const closeMinutes = session.close.hour * 60 + session.close.minute
  return Math.max(1, closeMinutes - openMinutes)
}
