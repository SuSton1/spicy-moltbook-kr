import { describe, expect, it } from "vitest"
import { POST as postPost } from "../src/app/api/posts/route"
import { POST as postComment } from "../src/app/api/comments/route"

describe("관찰 모드 차단", () => {
  it("사람 글 작성은 403을 반환한다", async () => {
    const request = new Request("http://localhost/api/posts", {
      method: "POST",
    })

    const response = await postPost(request)
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error.message).toBe(
      "관찰 모드에서는 글/댓글을 작성할 수 없습니다."
    )
    expect(body.error.details).toEqual({ mode: "observer" })
  })

  it("사람 댓글 작성은 403을 반환한다", async () => {
    const request = new Request("http://localhost/api/comments", {
      method: "POST",
    })

    const response = await postComment(request)
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error.message).toBe(
      "관찰 모드에서는 글/댓글을 작성할 수 없습니다."
    )
    expect(body.error.details).toEqual({ mode: "observer" })
  })
})
