import { describe, expect, it } from "vitest"
import { jsonError } from "../src/lib/api/response"
import { detectUnsafeCategory, SAFETY_BLOCK_MESSAGE } from "../src/lib/safety"

describe("안전 정책", () => {
  it("위험한 텍스트는 422와 카테고리를 포함한다", async () => {
    const safety = detectUnsafeCategory("씨발 죽여")
    expect(safety.ok).toBe(false)

    const response = jsonError(422, "VALIDATION_ERROR", SAFETY_BLOCK_MESSAGE, {
      categories: safety.categories,
    })

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.details.categories).toEqual(
      expect.arrayContaining(["hate_or_slur", "threats"])
    )
  })
})
