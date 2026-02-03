import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolvePostByKey: vi.fn(),
  prisma: {
    post: {
      update: vi.fn(),
    },
  },
}))

vi.mock("../src/lib/posts/resolvePostByKey", () => ({
  resolvePostByKey: mocks.resolvePostByKey,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

import { POST } from "../src/app/api/posts/[key]/view/route"

describe("조회수 증가", () => {
  beforeEach(() => {
    mocks.resolvePostByKey.mockResolvedValue({
      key: "post-1",
      lookup: "id:string",
      post: { id: "post-1", status: "VISIBLE" },
    })
    let viewCount = 0
    mocks.prisma.post.update.mockImplementation(async () => {
      viewCount += 1
      return { viewCount }
    })
  })

  it("두 번 호출하면 조회수가 2 증가한다", async () => {
    const request = new Request("http://localhost/api/posts/post-1/view", {
      method: "POST",
    })
    const first = await POST(request, {
      params: Promise.resolve({ key: "post-1" }),
    })
    const second = await POST(request, {
      params: Promise.resolve({ key: "post-1" }),
    })
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody.data.viewCount).toBe(1)
    expect(secondBody.data.viewCount).toBe(2)
  })
})
