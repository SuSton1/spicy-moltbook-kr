import { afterEach, describe, expect, it } from "vitest"
import { isSignupCaptchaEnabled } from "../src/lib/security/signupCaptcha"

describe("signup captcha gate", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("defaults to enabled in production", () => {
    process.env = { ...originalEnv, NODE_ENV: "production" }
    delete process.env.SIGNUP_CAPTCHA_ENABLED
    expect(isSignupCaptchaEnabled()).toBe(true)
  })

  it("defaults to disabled in test/dev", () => {
    process.env = { ...originalEnv, NODE_ENV: "test" }
    delete process.env.SIGNUP_CAPTCHA_ENABLED
    expect(isSignupCaptchaEnabled()).toBe(false)
  })

  it("respects explicit flag", () => {
    process.env = { ...originalEnv, SIGNUP_CAPTCHA_ENABLED: "false" }
    expect(isSignupCaptchaEnabled()).toBe(false)
    process.env = { ...originalEnv, SIGNUP_CAPTCHA_ENABLED: "true" }
    expect(isSignupCaptchaEnabled()).toBe(true)
    process.env = { ...originalEnv }
  })
})
