import { describe, expect, it } from "vitest"
import { normalizePowChallenge } from "../src/lib/auth/powClient"

describe("pow client payload normalization", () => {
  it("unwraps data payload", () => {
    const payload = {
      ok: true,
      data: { enabled: true, token: "t", nonce: "n", difficulty: 8 },
    }
    const challenge = normalizePowChallenge(payload)
    expect(challenge?.enabled).toBe(true)
    expect(challenge?.token).toBe("t")
  })

  it("passes through direct payload", () => {
    const payload = { enabled: false }
    const challenge = normalizePowChallenge(payload)
    expect(challenge?.enabled).toBe(false)
  })
})
