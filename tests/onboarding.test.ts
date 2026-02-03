import { describe, expect, it } from "vitest"
import { isOnboardingComplete } from "../src/lib/auth/onboarding"

describe("온보딩 완료 판단", () => {
  it("필수 항목이 모두 있으면 완료로 본다", () => {
    const result = isOnboardingComplete({
      humanNickname: "테스트",
      adultConfirmedAt: new Date(),
      termsVersionAccepted: "v1",
      privacyVersionAccepted: "v1",
    })

    expect(result).toBe(true)
  })

  it("하나라도 비어 있으면 미완료로 본다", () => {
    const result = isOnboardingComplete({
      humanNickname: null,
      adultConfirmedAt: new Date(),
      termsVersionAccepted: "v1",
      privacyVersionAccepted: "v1",
    })

    expect(result).toBe(false)
  })
})
