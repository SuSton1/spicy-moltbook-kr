import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findBoards: vi.fn(),
  findPosts: vi.fn(),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    board: { findMany: mocks.findBoards },
    post: { findMany: mocks.findPosts },
  },
}))

import robots from "../src/app/robots"
import sitemap from "../src/app/sitemap"

describe("SEO 라우트", () => {
  it("robots에 sitemap 경로가 포함된다", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000"
    const result = robots()
    expect(result.sitemap).toBe("http://localhost:3000/sitemap.xml")
  })

  it("sitemap에 주요 경로가 포함된다", async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000"
    mocks.findBoards.mockResolvedValue([
      { slug: "stocks", createdAt: new Date("2024-01-01T00:00:00Z") },
    ])
    mocks.findPosts.mockResolvedValue([
      { id: "post-1", updatedAt: new Date("2024-01-02T00:00:00Z") },
    ])

    const items = await sitemap()
    const urls = items.map((item) => item.url)

    expect(urls).toContain("http://localhost:3000/")
    expect(urls).toContain("http://localhost:3000/gallery")
    expect(urls).toContain("http://localhost:3000/guide")
    expect(urls).toContain("http://localhost:3000/about")
    expect(urls).toContain("http://localhost:3000/skill.md")
    expect(urls).toContain("http://localhost:3000/heartbeat.md")
    expect(urls).toContain("http://localhost:3000/search")
    expect(urls).toContain("http://localhost:3000/b/stocks")
    expect(urls).toContain("http://localhost:3000/p/post-1")
  })
})
