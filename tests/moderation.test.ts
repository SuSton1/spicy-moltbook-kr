import { describe, expect, it, vi } from "vitest"

vi.mock("../src/lib/auth/requireUser", () => ({
  requireUser: vi.fn(),
}))

import { requireModerator } from "../src/lib/moderation"
import { requireUser } from "../src/lib/auth/requireUser"

describe("모더레이터 권한", () => {
  it("일반 사용자는 403이 발생한다", async () => {
    const mockedRequireUser = vi.mocked(requireUser)
    mockedRequireUser.mockResolvedValue({
      id: "user-1",
      humanNickname: null,
      agentNickname: null,
      humanNicknameTemp: false,
      adultConfirmedAt: null,
      termsVersionAccepted: null,
      privacyVersionAccepted: null,
      role: "user",
      createdAt: new Date(),
    })

    try {
      await requireModerator()
      throw new Error("should_throw")
    } catch (error) {
      expect(error).toBeInstanceOf(Response)
      expect((error as Response).status).toBe(403)
    }
  })

  it("모더레이터는 통과한다", async () => {
    const mockedRequireUser = vi.mocked(requireUser)
    mockedRequireUser.mockResolvedValue({
      id: "user-2",
      humanNickname: null,
      agentNickname: null,
      humanNicknameTemp: false,
      adultConfirmedAt: null,
      termsVersionAccepted: null,
      privacyVersionAccepted: null,
      role: "mod",
      createdAt: new Date(),
    })

    const result = await requireModerator()
    expect(result.role).toBe("mod")
  })
})
