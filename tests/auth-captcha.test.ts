import { describe, expect, it } from "vitest"
import { createCaptcha, verifyCaptcha } from "../src/lib/auth/captcha"

type CaptchaRecord = {
  id: string
  ipHash: string
  answerHash: string
  expiresAt: Date
  attempts: number
  createdAt: Date
}

type CaptchaCreateArgs = {
  data: Omit<CaptchaRecord, "createdAt" | "id"> & { id?: string }
}

type CaptchaFindArgs = { where: { id: string } }
type CaptchaUpdateArgs = {
  where: { id: string }
  data: { attempts?: { increment: number } }
}
type CaptchaDeleteArgs = { where: { id: string } }

function makeCaptchaPrisma() {
  const store = new Map<string, CaptchaRecord>()
  let idCounter = 0

  return {
    store,
    prisma: {
      captchaChallenge: {
        create: async ({ data }: CaptchaCreateArgs) => {
          const id = data.id ?? `cap_${++idCounter}`
          const record: CaptchaRecord = { ...data, id, createdAt: new Date() }
          store.set(id, record)
          return record
        },
        findUnique: async ({ where }: CaptchaFindArgs) => {
          return store.get(where.id) ?? null
        },
        update: async ({ where, data }: CaptchaUpdateArgs) => {
          const record = store.get(where.id)
          if (!record) return null
          const next = {
            ...record,
            attempts:
              data?.attempts?.increment != null
                ? record.attempts + data.attempts.increment
                : record.attempts,
          }
          store.set(where.id, next)
          return next
        },
        delete: async ({ where }: CaptchaDeleteArgs) => {
          const record = store.get(where.id) ?? null
          store.delete(where.id)
          return record
        },
      },
    },
  }
}

describe("captcha", () => {
  it("creates and verifies captcha", async () => {
    process.env.IP_HASH_SECRET = "test-secret"
    const { prisma, store } = makeCaptchaPrisma()
    const result = await createCaptcha(prisma, "iphash", "12345")
    expect(result.captchaId).toBeTruthy()
    expect(result.svg).toContain("<svg")

    const wrong = await verifyCaptcha({
      prisma,
      ipHash: "iphash",
      captchaId: result.captchaId,
      text: "00000",
      consume: false,
    })
    expect(wrong.ok).toBe(false)
    const attemptsRecord = store.get(result.captchaId)
    if (!attemptsRecord) {
      throw new Error("captcha record missing after wrong attempt")
    }
    expect(attemptsRecord.attempts).toBe(1)

    const ok = await verifyCaptcha({
      prisma,
      ipHash: "iphash",
      captchaId: result.captchaId,
      text: "12345",
      consume: true,
    })
    expect(ok.ok).toBe(true)
    expect(store.has(result.captchaId)).toBe(false)
  })

  it("rejects expired captcha", async () => {
    process.env.IP_HASH_SECRET = "test-secret"
    const { prisma, store } = makeCaptchaPrisma()
    const result = await createCaptcha(prisma, "iphash", "54321")
    const record = store.get(result.captchaId)
    if (!record) {
      throw new Error("captcha record missing")
    }
    record.expiresAt = new Date(Date.now() - 1000)
    store.set(result.captchaId, record)

    const expired = await verifyCaptcha({
      prisma,
      ipHash: "iphash",
      captchaId: result.captchaId,
      text: "54321",
      consume: false,
    })
    expect(expired.ok).toBe(false)
  })

  it("uses deterministic captcha in test env when configured", async () => {
    process.env.IP_HASH_SECRET = "test-secret"
    const originalEnv = process.env
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      CAPTCHA_TEST_CODE: "11223",
      CAPTCHA_TEST_ID: "test-captcha-11223",
    }
    const { prisma } = makeCaptchaPrisma()
    const result = await createCaptcha(prisma, "iphash")
    expect(result.captchaId).toBe("test-captcha-11223")
    const ok = await verifyCaptcha({
      prisma,
      ipHash: "iphash",
      captchaId: result.captchaId,
      text: "11223",
      consume: false,
    })
    expect(ok.ok).toBe(true)
    process.env = originalEnv
  })
})
