import { afterEach, describe, expect, it } from "vitest"
import { shouldBypassSignupEnvGate } from "../src/lib/auth/signupEnvGateBypass"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("signup env gate bypass", () => {
  it("bypasses when enabled and user/email is allowlisted", () => {
    process.env.SIGNUP_ENV_GATE_BYPASS_ENABLED = "1"
    process.env.SIGNUP_ENV_GATE_BYPASS_USERS = "olis98"
    process.env.SIGNUP_ENV_GATE_BYPASS_EMAILS = "98_start@naver.com"

    expect(
      shouldBypassSignupEnvGate({
        username: "olis98",
        email: "someone@example.com",
        ip: "127.0.0.1",
      })
    ).toBe(true)

    expect(
      shouldBypassSignupEnvGate({
        username: "not-match",
        email: "98_start@naver.com",
        ip: "127.0.0.1",
      })
    ).toBe(true)
  })

  it("does not bypass when allowlist does not match", () => {
    process.env.SIGNUP_ENV_GATE_BYPASS_ENABLED = "1"
    process.env.SIGNUP_ENV_GATE_BYPASS_USERS = "olis98"
    process.env.SIGNUP_ENV_GATE_BYPASS_EMAILS = "98_start@naver.com"

    expect(
      shouldBypassSignupEnvGate({
        username: "other",
        email: "other@example.com",
        ip: "127.0.0.1",
      })
    ).toBe(false)
  })

  it("requires IP match when IP allowlist is set", () => {
    process.env.SIGNUP_ENV_GATE_BYPASS_ENABLED = "1"
    process.env.SIGNUP_ENV_GATE_BYPASS_USERS = "olis98"
    process.env.SIGNUP_ENV_GATE_BYPASS_IPS = "10.0.0.1"

    expect(
      shouldBypassSignupEnvGate({
        username: "olis98",
        email: "x@example.com",
        ip: "10.0.0.1",
      })
    ).toBe(true)

    expect(
      shouldBypassSignupEnvGate({
        username: "olis98",
        email: "x@example.com",
        ip: "10.0.0.2",
      })
    ).toBe(false)
  })
})
