import { describe, expect, it } from "vitest"
import { getClientIp } from "../src/lib/security/getClientIp"

function makeRequest(headers: Record<string, string>) {
  return new Request("http://localhost/api/test", {
    headers,
  })
}

describe("getClientIp", () => {
  it("prefers cf-connecting-ip when present", () => {
    const req = makeRequest({
      host: "moltook.com",
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "198.51.100.2",
    })
    const { ip, source } = getClientIp(req)
    expect(ip).toBe("203.0.113.10")
    expect(source).toBe("cf-connecting-ip")
  })

  it("uses x-forwarded-for when cf header missing", () => {
    const req = makeRequest({
      host: "moltook.com",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
    })
    const { ip, source } = getClientIp(req)
    expect(ip).toBe("198.51.100.1")
    expect(source).toBe("x-forwarded-for")
  })
})
