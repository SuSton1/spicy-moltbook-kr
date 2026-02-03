import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetPasswordWithRecoveryCode } from "@/lib/security/recoveryReset"
import { hashRecoveryCode } from "@/lib/recoveryCodes"

type UserRow = {
  id: string
  username: string
  recoverySalt: string
  passwordHash?: string
}

type CodeRow = {
  id: string
  userId: string
  codeHash: string
  usedAt: Date | null
}

const mocks = vi.hoisted(() => {
  const userStore = new Map<string, UserRow>()
  const codeStore = new Map<string, CodeRow>()
  const prismaMock = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { username: string } }) => {
        return userStore.get(where.username) ?? null
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<UserRow>
        }) => {
          for (const [key, user] of userStore.entries()) {
            if (user.id === where.id) {
              userStore.set(key, { ...user, ...data })
            }
          }
          return null
        }
      ),
    },
    recoveryCode: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; codeHash: string; usedAt: null }
        }) => {
          for (const code of codeStore.values()) {
            if (
              code.userId === where.userId &&
              code.codeHash === where.codeHash &&
              !code.usedAt
            ) {
              return code
            }
          }
          return null
        }
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<CodeRow>
        }) => {
          const code = codeStore.get(where.id)
          if (code) {
            codeStore.set(where.id, { ...code, ...data })
          }
          return null
        }
      ),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { userStore, codeStore, prismaMock }
})

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prismaMock,
}))

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async () => "hashed"),
}))

describe("recovery reset flow", () => {
  beforeEach(() => {
    mocks.userStore.clear()
    mocks.codeStore.clear()
    mocks.prismaMock.user.findUnique.mockClear()
    mocks.prismaMock.recoveryCode.findFirst.mockClear()
  })

  it("accepts valid code once and rejects reuse", async () => {
    const user = { id: "u1", username: "user1", recoverySalt: "salt" }
    mocks.userStore.set("user1", user)
    const rawCode = "abcd-1234-efef-5678"
    const codeHash = hashRecoveryCode(rawCode, user.recoverySalt)
    mocks.codeStore.set("c1", { id: "c1", userId: "u1", codeHash, usedAt: null })

    const ok = await resetPasswordWithRecoveryCode({
      username: "user1",
      recoveryCode: rawCode,
      newPassword: "Newpass1",
    })
    expect(ok.ok).toBe(true)
    expect(mocks.codeStore.get("c1")?.usedAt).toBeTruthy()

    const reuse = await resetPasswordWithRecoveryCode({
      username: "user1",
      recoveryCode: rawCode,
      newPassword: "Newpass2",
    })
    expect(reuse.ok).toBe(false)
  })

  it("rejects invalid recovery code", async () => {
    const user = { id: "u2", username: "user2", recoverySalt: "salt2" }
    mocks.userStore.set("user2", user)

    const result = await resetPasswordWithRecoveryCode({
      username: "user2",
      recoveryCode: "wrong-code",
      newPassword: "Newpass1",
    })
    expect(result.ok).toBe(false)
  })
})
