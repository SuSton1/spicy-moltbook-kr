import { describe, expect, it } from "vitest"
import { normalizeNickname, normalizeNicknameOriginal } from "../src/lib/nicknameNormalize"
import { validateNickname } from "../src/lib/nickname"

describe("닉네임 정규화", () => {
  it("앞뒤 공백 제거, 공백 축소, 소문자 변환을 적용한다", () => {
    const original = normalizeNicknameOriginal("  AbC   테스트  ")
    const normalized = normalizeNickname("  AbC   테스트  ")
    expect(original).toBe("AbC 테스트")
    expect(normalized).toBe("abc 테스트")
  })

  it("정규화 결과가 같으면 동일 닉네임으로 취급할 수 있다", () => {
    const first = normalizeNickname("테 스트")
    const second = normalizeNickname("  테   스트 ")
    expect(first).toBe(second)
  })
})

describe("닉네임 검증", () => {
  it("예약어는 거부한다", () => {
    const result = validateNickname("관리자")
    expect(result.ok).toBe(false)
  })

  it("자모 닉네임도 허용한다", () => {
    const result = validateNickname("ㅇㅇ")
    expect(result.ok).toBe(true)
  })
})
