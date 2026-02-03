import { describe, expect, it } from "vitest"
import { createEmailCode, verifyEmailCode } from "../src/lib/auth/emailCode"

type EmailCodeRecord = {
  id: string
  email: string
  purpose: string
  codeHash: string
  expiresAt: Date
  consumedAt: Date | null
  attempts: number
  ipHash: string | null
  createdAt: Date
}

type EmailCreateArgs = {
  data: Omit<EmailCodeRecord, "id" | "createdAt" | "consumedAt">
}
type EmailUpdateManyArgs = {
  where: { email: string; purpose: string; consumedAt: null }
  data: { consumedAt: Date }
}
type EmailFindArgs = { where: { email: string; purpose: string; consumedAt: null } }
type EmailUpdateArgs = {
  where: { id: string }
  data: { attempts?: { increment: number }; consumedAt?: Date }
}

function makeEmailCodePrisma() {
  const store: EmailCodeRecord[] = []
  let idCounter = 0

  return {
    store,
    prisma: {
      emailCode: {
        updateMany: async ({ where, data }: EmailUpdateManyArgs) => {
          for (const item of store) {
            if (
              item.email === where.email &&
              item.purpose === where.purpose &&
              item.consumedAt === null
            ) {
              item.consumedAt = data.consumedAt
            }
          }
          return { count: store.length }
        },
        create: async ({ data }: EmailCreateArgs) => {
          const record: EmailCodeRecord = {
            id: `code_${++idCounter}`,
            ...data,
            consumedAt: null,
            createdAt: new Date(),
          }
          store.push(record)
          return record
        },
        findFirst: async ({ where }: EmailFindArgs) => {
          const candidates = store.filter(
            (item) =>
              item.email === where.email &&
              item.purpose === where.purpose &&
              item.consumedAt === null
          )
          return candidates[candidates.length - 1] ?? null
        },
        update: async ({ where, data }: EmailUpdateArgs) => {
          const record = store.find((item) => item.id === where.id)
          if (!record) return null
          if (data.attempts?.increment != null) {
            record.attempts += data.attempts.increment
          }
          if (data.consumedAt) {
            record.consumedAt = data.consumedAt
          }
          return record
        },
      },
    },
  }
}

describe("email code", () => {
  it("creates and verifies email codes", async () => {
    process.env.IP_HASH_SECRET = "test-secret"
    const { prisma } = makeEmailCodePrisma()
    const { code } = await createEmailCode({
      prisma,
      email: "test@example.com",
      purpose: "signup_verify",
      ipHash: "hash",
    })

    const wrong = await verifyEmailCode({
      prisma,
      email: "test@example.com",
      purpose: "signup_verify",
      code: "000000",
    })
    expect(wrong.ok).toBe(false)

    const ok = await verifyEmailCode({
      prisma,
      email: "test@example.com",
      purpose: "signup_verify",
      code,
    })
    expect(ok.ok).toBe(true)
  })

  it("handles expiry and attempts", async () => {
    process.env.IP_HASH_SECRET = "test-secret"
    const { prisma, store } = makeEmailCodePrisma()
    const { code } = await createEmailCode({
      prisma,
      email: "expired@example.com",
      purpose: "reset_password",
      ipHash: "hash",
    })

    const record = store[store.length - 1]
    if (!record) {
      throw new Error("email code missing")
    }
    record.expiresAt = new Date(Date.now() - 1000)

    const expired = await verifyEmailCode({
      prisma,
      email: "expired@example.com",
      purpose: "reset_password",
      code,
    })
    expect(expired.ok).toBe(false)

    await createEmailCode({
      prisma,
      email: "lock@example.com",
      purpose: "reset_password",
      ipHash: "hash",
    })

    for (let i = 0; i < 5; i += 1) {
      await verifyEmailCode({
        prisma,
        email: "lock@example.com",
        purpose: "reset_password",
        code: "000000",
      })
    }

    const locked = await verifyEmailCode({
      prisma,
      email: "lock@example.com",
      purpose: "reset_password",
      code: "000000",
    })
    expect(locked.ok).toBe(false)
  })
})
