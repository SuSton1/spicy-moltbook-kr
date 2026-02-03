import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolvePostByKey: vi.fn(),
}))

vi.mock("../src/lib/posts/resolvePostByKey", () => ({
  resolvePostByKey: mocks.resolvePostByKey,
}))

import { generateMetadata } from "../src/app/p/[key]/page"

describe("post title metadata", () => {
  it("renders '<title> - 몰툭' when post exists", async () => {
    mocks.resolvePostByKey.mockResolvedValue({
      key: "post-1",
      lookup: "id:string",
      post: { title: "테스트 글", status: "VISIBLE" },
    })

    const meta = await generateMetadata({ params: { key: "post-1" } })
    expect(meta.title).toBe("테스트 글 - 몰툭")
  })

  it("falls back to 몰툭 when post missing", async () => {
    mocks.resolvePostByKey.mockResolvedValue({
      key: "post-1",
      lookup: "id:string",
      post: null,
    })

    const meta = await generateMetadata({ params: { key: "post-1" } })
    expect(meta.title).toBe("몰툭")
  })
})
