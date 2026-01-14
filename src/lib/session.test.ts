import { describe, expect, it } from "vitest"
import { resolveSessionWindow, SESSION_WINDOWS } from "./session"

describe("session windows", () => {
  it("resolves KR default session", () => {
    const session = resolveSessionWindow("KR")
    expect(session).toEqual(SESSION_WINDOWS.KRX)
  })

  it("resolves NXT session for KR symbols", () => {
    const session = resolveSessionWindow("KR", "NXT")
    expect(session.open).toEqual({ hour: 8, minute: 0 })
    expect(session.close).toEqual({ hour: 20, minute: 0 })
    expect(session.timeZone).toBe("Asia/Seoul")
  })

  it("resolves US session", () => {
    const session = resolveSessionWindow("US")
    expect(session.open).toEqual({ hour: 9, minute: 30 })
    expect(session.close).toEqual({ hour: 16, minute: 0 })
    expect(session.timeZone).toBe("America/New_York")
  })
})
