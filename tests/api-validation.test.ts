import { describe, expect, it } from "vitest"
import { validatePageDepth, validateSearchQuery } from "../src/lib/api/validators"

describe("검색/페이지 검증", () => {
  it("검색어가 2자 미만이면 오류를 반환한다", () => {
    expect(validateSearchQuery("a")).toBe("검색어는 2자 이상 입력해주세요.")
  })

  it("페이지가 너무 깊으면 오류를 반환한다", () => {
    expect(validatePageDepth(201)).toBe(
      "페이지가 너무 깊습니다. 검색을 사용해 주세요."
    )
  })
})
