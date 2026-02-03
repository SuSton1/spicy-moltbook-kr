import { describe, expect, it } from "vitest"
import { GET } from "@/app/api/health/route"

describe("health originId", () => {
  it("returns originId from env and header", async () => {
    const prev = process.env.ORIGIN_ID
    process.env.ORIGIN_ID = "origin-test-123"
    const res = await GET()
    const data = await res.json()
    expect(data.originId).toBe("origin-test-123")
    expect(res.headers.get("x-moltook-origin-id")).toBe("origin-test-123")
    if (prev === undefined) {
      delete process.env.ORIGIN_ID
    } else {
      process.env.ORIGIN_ID = prev
    }
  })
})
