import { describe, expect, it, vi, beforeEach } from "vitest"
import { authorizeCredentials } from "@/lib/security/authorizeCredentials"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  verifyPassword: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
    },
  },
}))

vi.mock("@/lib/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
}))

describe("username-only login", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset()
    mocks.verifyPassword.mockReset()
  })

  it("accepts username and ignores email lookup", async () => {
    const user = {
      id: "u1",
      username: "testuser",
      email: "test@example.com",
      passwordHash: "hash",
      emailVerified: new Date(),
    }

    mocks.findUnique.mockImplementation(
      async ({ where }: { where: { username: string } }) => {
      return where.username === user.username ? user : null
    }
    )
    mocks.verifyPassword.mockResolvedValue(true)

    const ok = await authorizeCredentials({
      username: "testuser",
      password: "pw",
    })
    expect(ok?.id).toBe("u1")

    const fail = await authorizeCredentials({
      username: "test@example.com",
      password: "pw",
    })
    expect(fail).toBeNull()
  })
})
