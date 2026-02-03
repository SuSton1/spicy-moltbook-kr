import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  readJsonWithLimit: vi.fn(),
  getClientIp: vi.fn(),
  getDeviceIdHash: vi.fn(),
  verifyCaptcha: vi.fn(),
  logSecurityEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  reserveSignupIpLock: vi.fn(),
  reserveSignupDeviceLock: vi.fn(),
  bindSignupIpLock: vi.fn(),
  bindSignupDeviceLock: vi.fn(),
  checkPowPayload: vi.fn(),
  isPowEnabled: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  prisma: {
    signupIpLock: { count: vi.fn() },
    signupDeviceLock: { count: vi.fn() },
    recoveryCode: { count: vi.fn() },
  },
}))

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  }),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

vi.mock("../src/lib/security/readJsonWithLimit", () => ({
  readJsonWithLimit: mocks.readJsonWithLimit,
}))

vi.mock("../src/lib/security/getClientIp", () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock("../src/lib/security/deviceId", () => ({
  getDeviceIdHash: mocks.getDeviceIdHash,
}))

vi.mock("../src/lib/security/rateLimitDb", () => ({
  checkRateLimit: mocks.checkRateLimit,
}))

vi.mock("../src/lib/security/audit", () => ({
  logSecurityEvent: mocks.logSecurityEvent,
}))

vi.mock("../src/lib/security/signupLocks", () => ({
  bindSignupDeviceLock: mocks.bindSignupDeviceLock,
  bindSignupIpLock: mocks.bindSignupIpLock,
  reserveSignupDeviceLock: mocks.reserveSignupDeviceLock,
  reserveSignupIpLock: mocks.reserveSignupIpLock,
}))

vi.mock("../src/lib/security/pow", () => ({
  checkPowPayload: mocks.checkPowPayload,
  isPowEnabled: mocks.isPowEnabled,
}))

vi.mock("../src/lib/auth/captcha", () => ({
  verifyCaptcha: mocks.verifyCaptcha,
}))

import { POST } from "../src/app/api/auth/register/route"

describe("signup captcha", () => {
  beforeEach(() => {
    process.env.SIGNUP_CAPTCHA_ENABLED = "true"
    mocks.prisma.signupIpLock.count.mockResolvedValue(0)
    mocks.prisma.signupDeviceLock.count.mockResolvedValue(0)
    mocks.prisma.recoveryCode.count.mockResolvedValue(0)
    mocks.getClientIp.mockReturnValue({ ip: "127.0.0.1", source: "x-forwarded-for" })
    mocks.getDeviceIdHash.mockResolvedValue({
      deviceId: "did",
      deviceIdHash: "hash",
      didSetCookie: false,
    })
    mocks.checkPowPayload.mockReturnValue({ ok: true })
    mocks.isPowEnabled.mockReturnValue(false)
    mocks.cookieGet.mockReturnValue({ value: "cap_test" })
  })

  it("rejects invalid captcha", async () => {
    mocks.readJsonWithLimit.mockResolvedValue({
      username: "tester_1",
      email: "tester_1@example.com",
      password: "TestPassword123!",
      passwordConfirm: "TestPassword123!",
      acceptTerms: true,
      captchaId: "cap_test",
      captchaText: "00000",
    })
    mocks.verifyCaptcha.mockResolvedValue({ ok: false, error: "CAPTCHA_INVALID" })

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    })

    const response = await POST(request)
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error?.code).toBe("CAPTCHA_INVALID")
  })
})
