import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkPowPayload,
  createPowChallenge,
} from "@/lib/security/pow"

function hasLeadingZeroBits(hashHex: string, bits: number) {
  let remaining = bits
  for (let i = 0; i < hashHex.length; i += 2) {
    const byte = Number.parseInt(hashHex.slice(i, i + 2), 16)
    if (remaining >= 8) {
      if (byte !== 0) return false
      remaining -= 8
    } else if (remaining > 0) {
      const mask = 0xff << (8 - remaining)
      if ((byte & mask) !== 0) return false
      return true
    } else {
      return true
    }
  }
  return true
}

function solvePowSync(nonce: string, difficulty: number) {
  let counter = 0
  while (true) {
    const candidate = counter.toString(16)
    const hash = crypto
      .createHash("sha256")
      .update(`${nonce}:${candidate}`)
      .digest("hex")
    if (hasLeadingZeroBits(hash, difficulty)) {
      return candidate
    }
    counter += 1
  }
}

describe("pow payload checks", () => {
  const env = { ...process.env }

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret"
    process.env.SIGNUP_POW_DIFFICULTY = "8"
    process.env.SIGNUP_POW_TTL_SEC = "300"
  })

  afterEach(() => {
    process.env = { ...env }
  })

  it("skips when disabled", () => {
    const result = checkPowPayload({
      enabled: false,
      token: "",
      solution: "",
    })
    expect(result.ok).toBe(true)
  })

  it("returns POW_REQUIRED when missing token/solution", () => {
    const result = checkPowPayload({ enabled: true, token: "", solution: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("POW_REQUIRED")
    }
  })

  it("returns POW_INVALID on bad solution", () => {
    const challenge = createPowChallenge()
    const result = checkPowPayload({
      enabled: true,
      token: challenge.token,
      solution: "bad",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("POW_INVALID")
    }
  })

  it("accepts a valid solution", () => {
    const challenge = createPowChallenge()
    const solution = solvePowSync(challenge.nonce, challenge.difficulty)
    const result = checkPowPayload({
      enabled: true,
      token: challenge.token,
      solution,
    })
    expect(result.ok).toBe(true)
  })
})
