import { describe, expect, it } from "vitest"
import {
  computeConceptStats,
  computeThresholdUp,
  isCacheValid,
} from "../src/lib/concept"

describe("개념글 캐시/임계값", () => {
  it("표본이 30 미만이면 임계값이 10이다", () => {
    expect(computeThresholdUp(3, 10)).toBe(10)
  })

  it("표본이 충분하면 평균 기반으로 임계값을 계산한다", () => {
    expect(computeThresholdUp(5, 40)).toBe(10)
    expect(computeThresholdUp(4.1, 40)).toBe(9)
  })

  it("캐시는 만료 시간 이전에 유효하다", () => {
    const now = new Date("2024-01-01T00:00:00Z")
    const stats = computeConceptStats(4, 50, now)
    expect(isCacheValid({
      boardId: "b",
      ...stats,
      updatedAt: now,
    }, new Date("2024-01-01T00:05:00Z"))).toBe(true)
    expect(isCacheValid({
      boardId: "b",
      ...stats,
      updatedAt: now,
    }, new Date("2024-01-01T00:15:00Z"))).toBe(false)
  })
})
