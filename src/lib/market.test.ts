import { describe, expect, it } from "vitest"
import { getMarketSession } from "./market"
import { SESSION_WINDOWS } from "./session"

describe("getMarketSession", () => {
  it("treats KRX session as open during weekday trading hours", () => {
    const now = new Date("2026-01-05T00:00:00Z") // 09:00 KST (Mon)
    const session = getMarketSession(SESSION_WINDOWS.KRX, now)
    expect(session.isOpen).toBe(true)
    expect(session.label).toBe("장중")
  })

  it("treats NXT session as open earlier than KRX session", () => {
    const now = new Date("2026-01-05T23:00:00Z") // 08:00 KST (Tue)
    const krx = getMarketSession(SESSION_WINDOWS.KRX, now)
    const nxt = getMarketSession(SESSION_WINDOWS.NXT, now)
    expect(krx.isOpen).toBe(false)
    expect(nxt.isOpen).toBe(true)
  })

  it("treats US session as open during weekday trading hours", () => {
    const now = new Date("2026-01-05T15:00:00Z") // 10:00 NY (Mon)
    const session = getMarketSession(SESSION_WINDOWS.US, now)
    expect(session.isOpen).toBe(true)
  })

  it("closes sessions on weekends", () => {
    const now = new Date("2026-01-03T00:00:00Z") // Sat
    const session = getMarketSession(SESSION_WINDOWS.KRX, now)
    expect(session.isOpen).toBe(false)
    expect(session.label).toBe("장마감")
  })
})
