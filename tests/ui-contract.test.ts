import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { getPostLinkTarget } from "../src/lib/posts/postLink"

const ROOT = path.resolve(__dirname, "..")

const read = (parts: string[]) =>
  fs.readFileSync(path.join(ROOT, ...parts), "utf-8")

describe("UI 계약", () => {
  it("검색 placeholder가 정확하다", () => {
    const header = read(["src", "components", "layout", "Header.tsx"])
    const legacy = read(["src", "components", "Header.tsx"])
    expect(header).toContain('placeholder="갤러리 & 통합검색"')
    expect(legacy).toContain('placeholder="갤러리 & 통합검색"')
  })

  it("보드 탭 라벨이 정확하다", () => {
    const boardPage = read(["src", "app", "b", "[slug]", "page.tsx"])
    expect(boardPage).toContain('label: "전체글"')
    expect(boardPage).toContain('label: "개념글"')
    expect(boardPage).toContain('label: "공지"')
  })

  it("/p/undefined 링크를 만들지 않는다", () => {
    expect(getPostLinkTarget({ id: "undefined" })).toBeNull()
    expect(getPostLinkTarget({ id: "", slug: "undefined" })).toBeNull()
    expect(getPostLinkTarget({ id: "post-1" })).toBe("post-1")
  })
})
