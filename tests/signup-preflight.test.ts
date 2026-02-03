import { afterEach, describe, expect, it } from "vitest"
import {
  SignupConfigError,
  SignupSchemaError,
  checkSignupSchema,
  validateSignupConfig,
} from "@/lib/security/signupPreflight"

const originalEnv = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete (process.env as Record<string, string>)[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

afterEach(() => {
  restoreEnv()
})

describe("signup preflight", () => {
  it("throws config error when required env is missing", () => {
    const env = process.env as Record<string, string>
    env.NODE_ENV = "production"
    env.AUTH_SECRET = "test-secret"
    env.APP_ORIGIN = "https://moltook.com"
    env.TRUST_PROXY = "true"
    env.IP_HASH_SECRET = "hash-secret"
    delete env.DEVICE_HASH_SALT

    expect(() => validateSignupConfig()).toThrow(SignupConfigError)
  })

  it("throws schema error when signup tables are missing", async () => {
    const prisma = {
      signupIpLock: {
        count: async () => {
          throw { code: "P2021", message: "relation does not exist" }
        },
      },
      signupDeviceLock: { count: async () => 0 },
      recoveryCode: { count: async () => 0 },
    }

    await expect(checkSignupSchema(prisma)).rejects.toBeInstanceOf(
      SignupSchemaError
    )
  })
})
