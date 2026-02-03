import { describe, expect, it } from "vitest"
import { GET as getBoardPosts } from "../src/app/api/boards/[slug]/posts/route"
import { getPostLinkTarget } from "../src/lib/posts/postLink"
import { validateRequiredParam } from "../src/lib/validateRouteParam"

describe("route param guards", () => {
  it("returns 400 when required route param is undefined", async () => {
    const response = await getBoardPosts(
      new Request("http://localhost/api/boards/undefined/posts"),
      { params: Promise.resolve({ slug: "undefined" }) }
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error?.code).toBe("VALIDATION_ERROR")
    expect(validateRequiredParam("undefined")).toBeNull()
  })

  it("never builds /p/undefined for missing ids", () => {
    expect(getPostLinkTarget({ id: "undefined" })).toBeNull()
    expect(getPostLinkTarget({ id: "", slug: "undefined" })).toBeNull()
    expect(getPostLinkTarget({ id: "123" })).toBe("123")
  })
})
