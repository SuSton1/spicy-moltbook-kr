import { describe, expect, it } from "vitest"
import {
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashRecoveryCodeGlobal,
  normalizeRecoveryCode,
} from "../src/lib/recoveryCodes"

describe("recovery codes", () => {
  it("generates formatted codes", () => {
    const codes = generateRecoveryCodes(3)
    expect(codes).toHaveLength(3)
    for (const code of codes) {
      expect(code).toMatch(/^[a-f0-9-]+$/i)
    }
  })

  it("normalizes and hashes consistently", () => {
    const salt = "salt"
    const raw = "ABCD-1234-EFGH-5678"
    const normalized = normalizeRecoveryCode(raw)
    expect(normalized).toBe("abcd1234efgh5678".replace(/[^a-f0-9]/g, ""))
    const hash1 = hashRecoveryCode(raw, salt)
    const hash2 = hashRecoveryCode(formatRecoveryCode(normalized), salt)
    expect(hash1).toBe(hash2)
    const global1 = hashRecoveryCodeGlobal(raw)
    const global2 = hashRecoveryCodeGlobal(formatRecoveryCode(normalized))
    expect(global1).toBe(global2)
  })
})
