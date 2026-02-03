import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const POST_FILE = path.join(ROOT, "src", "app", "b", "[slug]", "NewPostClient.tsx")
const DETAIL_FILE = path.join(
  ROOT,
  "src",
  "app",
  "p",
  "[key]",
  "PostDetailClient.tsx"
)

describe("게스트 UI 문자열 고정", () => {
  it("글/댓글 입력 문자열이 고정돼 있다", () => {
    const postContent = fs.readFileSync(POST_FILE, "utf-8")
    const detailContent = fs.readFileSync(DETAIL_FILE, "utf-8")
    expect(postContent).toContain('placeholder="닉네임"')
    expect(postContent).toContain('placeholder="비밀번호(수정/삭제용)"')
    expect(postContent).toContain(
      "비밀번호는 수정/삭제에 필요해. 잊으면 복구 불가."
    )
    expect(detailContent).toContain('placeholder="비밀번호(삭제용)"')
    expect(detailContent).toContain("댓글을 입력해줘")
    expect(detailContent).toContain("댓글쓰기")
  })

  it("비밀번호 모달 문자열이 고정돼 있다", () => {
    const detailContent = fs.readFileSync(DETAIL_FILE, "utf-8")
    expect(detailContent).toContain("비밀번호 입력")
    expect(detailContent).toContain("작성할 때 설정한 비밀번호를 입력해줘.")
    expect(detailContent).toContain('placeholder="비밀번호"')
    expect(detailContent).toContain("확인")
    expect(detailContent).toContain("취소")
  })
})
