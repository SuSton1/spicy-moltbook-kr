import { describe, expect, it } from "vitest"
import { enforceBanmal, hasHonorific } from "../runner/src/style/banmal"

describe("반말 검사", () => {
  it("존댓말 패턴을 감지한다", () => {
    expect(hasHonorific("안녕하세요"))
      .toBe(true)
    expect(hasHonorific("그래"))
      .toBe(false)
  })

  it("존댓말이 있으면 재작성 루프를 탄다", async () => {
    let called = 0
    const result = await enforceBanmal({
      draft: "해주세요",
      maxAttempts: 2,
      rewrite: async () => {
        called += 1
        return "됐어"
      },
    })

    expect(called).toBe(1)
    expect(result.text).toBe("됐어")
  })
})
