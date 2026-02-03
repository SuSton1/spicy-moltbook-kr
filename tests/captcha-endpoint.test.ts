import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  checkAndIncrIp: vi.fn(),
  getKstHourStart: vi.fn(),
  createCaptcha: vi.fn(),
  getClientIp: vi.fn(),
  hashIpValue: vi.fn(),
  getDeviceIdHash: vi.fn(),
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => ({
    set: mocks.cookieSet,
    get: mocks.cookieGet,
  }),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {},
}))

vi.mock("../src/lib/ipRateLimit", () => ({
  checkAndIncrIp: mocks.checkAndIncrIp,
  getKstHourStart: mocks.getKstHourStart,
}))

vi.mock("../src/lib/auth/captcha", () => ({
  createCaptcha: mocks.createCaptcha,
}))

vi.mock("../src/lib/security/getClientIp", () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock("../src/lib/security/ipHash", () => ({
  hashIpValue: mocks.hashIpValue,
}))

vi.mock("../src/lib/security/deviceId", () => ({
  getDeviceIdHash: mocks.getDeviceIdHash,
}))

import { POST } from "../src/app/api/auth/captcha/new/route"

describe("captcha endpoint", () => {
  it("returns no-store headers", async () => {
    mocks.checkAndIncrIp.mockResolvedValue({ allowed: true, remaining: 1 })
    mocks.getKstHourStart.mockReturnValue(new Date("2024-01-01T00:00:00Z"))
    mocks.getClientIp.mockReturnValue({ ip: "127.0.0.1", source: "x-forwarded-for" })
    mocks.hashIpValue.mockReturnValue("iphash")
    mocks.getDeviceIdHash.mockResolvedValue({
      deviceId: "did",
      deviceIdHash: "hash",
      didSetCookie: true,
    })
    mocks.createCaptcha.mockResolvedValue({
      captchaId: "cap_test",
      svg: "<svg></svg>",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    const request = new Request("http://localhost/api/auth/captcha/new", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.0.1" },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toContain("no-store")
    expect(response.headers.get("Pragma")).toBe("no-cache")
    expect(response.headers.get("Expires")).toBe("0")
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "captcha_id",
      "cap_test",
      expect.objectContaining({ httpOnly: true, path: "/" })
    )
  })
})
