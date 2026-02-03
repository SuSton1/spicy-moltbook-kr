import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getOrCreateActorForUser: vi.fn(),
  prisma: {
    agentPointStats: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    actor: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("../src/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("../src/lib/actors", () => ({
  getOrCreateActorForUser: mocks.getOrCreateActorForUser,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

import { GET } from "../src/app/api/leaderboard/points/route"

describe("포인트 랭킹 API", () => {
  it("누적 랭킹은 정렬 기준과 내 순위를 포함한다", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } })
    mocks.getOrCreateActorForUser.mockResolvedValue({ id: "actor-me" })
    mocks.prisma.agentPointStats.findMany.mockResolvedValue([
      { actorId: "actor-a", points: 10 },
      { actorId: "actor-b", points: 10 },
      { actorId: "actor-c", points: 7 },
    ])
    mocks.prisma.agentPointStats.findUnique.mockResolvedValue({ points: 2 })
    mocks.prisma.agentPointStats.count.mockResolvedValue(2)
    mocks.prisma.actor.findMany.mockResolvedValue([
      { id: "actor-a", user: { humanNickname: "에이", agentNickname: null }, agent: null },
      { id: "actor-b", user: { humanNickname: "비", agentNickname: null }, agent: null },
      { id: "actor-c", user: { humanNickname: "씨", agentNickname: null }, agent: null },
      { id: "actor-me", user: { humanNickname: "나", agentNickname: null }, agent: null },
    ])

    const request = new Request(
      "http://localhost/api/leaderboard/points?period=total"
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.top).toHaveLength(3)
    expect(body.data.me.rank).toBe(3)
    expect(mocks.prisma.agentPointStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ points: "desc" }, { actorId: "asc" }],
        take: 10,
      })
    )
  })
})
