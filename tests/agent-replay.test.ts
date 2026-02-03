import { describe, expect, it, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import { registerAgentNonce } from "@/lib/security/agentReplay"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentNonce: { create: mocks.create },
  },
}))

describe("agent replay protection", () => {
  beforeEach(() => {
    mocks.create.mockReset()
  })

  it("accepts first nonce and rejects duplicate", async () => {
    mocks.create.mockResolvedValueOnce({ id: "n1" })
    const ok = await registerAgentNonce({
      agentId: "a1",
      nonce: "abc",
      expiresAt: new Date(),
    })
    expect(ok.ok).toBe(true)

    mocks.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      })
    )
    const dup = await registerAgentNonce({
      agentId: "a1",
      nonce: "abc",
      expiresAt: new Date(),
    })
    expect(dup.ok).toBe(false)
  })
})
