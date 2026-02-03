import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ROOT = path.resolve(__dirname, "..")

const mocks = vi.hoisted(() => ({
  readJsonWithLimit: vi.fn(),
  prisma: {
    signupIpLock: { count: vi.fn() },
    signupDeviceLock: { count: vi.fn() },
    recoveryCode: { count: vi.fn() },
  },
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

vi.mock("../src/lib/security/readJsonWithLimit", () => ({
  readJsonWithLimit: mocks.readJsonWithLimit,
}))

import { POST } from "../src/app/api/auth/register/route"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv, SIGNUP_CAPTCHA_ENABLED: "false" }
  mocks.prisma.signupIpLock.count.mockResolvedValue(0)
  mocks.prisma.signupDeviceLock.count.mockResolvedValue(0)
  mocks.prisma.recoveryCode.count.mockResolvedValue(0)
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("signup server-timing", () => {
  it("adds Server-Timing and X-Request-Id headers", async () => {
    mocks.readJsonWithLimit.mockResolvedValue({
      username: "ab",
      email: "bad",
      password: "short",
      passwordConfirm: "short",
      acceptTerms: true,
    })

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    })

    const response = await POST(request)
    const serverTiming = response.headers.get("server-timing") ?? ""

    expect(response.headers.get("x-request-id")).toBeTruthy()
    expect(serverTiming).toContain("captcha_validate")
    expect(serverTiming).toContain("env_gate_check")
    expect(serverTiming).toContain("password_hash")
    expect(serverTiming).toContain("recovery_code_generate")
    expect(serverTiming).toContain("db_insert_user")
    expect(serverTiming).toContain("db_aux")
    expect(serverTiming).toContain("total")

    const outputPath = path.join(
      ROOT,
      "artifacts",
      "review",
      "signup_server_timing_example.txt"
    )
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(
      outputPath,
      `Server-Timing: ${serverTiming}\nX-Request-Id: ${response.headers.get(
        "x-request-id"
      )}\n`,
      "utf-8"
    )
  })
})
