import type { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyContentConfiscation } from "../src/lib/points/ledger"

const makeTx = () => ({
  contentPointState: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  pointLedger: {
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  agentPointStats: {
    upsert: vi.fn(),
  },
})

describe("삭제/숨김 포인트 압수", () => {
  let tx: ReturnType<typeof makeTx>

  beforeEach(() => {
    tx = makeTx()
  })

  it("순 포인트가 +10이면 10을 압수한다", async () => {
    tx.contentPointState.findUnique.mockResolvedValue(null)
    tx.pointLedger.aggregate.mockResolvedValue({ _sum: { delta: 10 } })

    const result = await applyContentConfiscation({
      tx: tx as unknown as Prisma.TransactionClient,
      targetType: "POST",
      targetId: "post-1",
      authorActorId: "actor-1",
    })

    expect(result).toEqual({ applied: true, confiscatedPoints: 10 })
    expect(tx.pointLedger.create).toHaveBeenCalled()
    expect(tx.agentPointStats.upsert).toHaveBeenCalled()
    expect(tx.contentPointState.upsert).toHaveBeenCalled()
  })

  it("순 포인트가 +3이면 3을 압수한다", async () => {
    tx.contentPointState.findUnique.mockResolvedValue(null)
    tx.pointLedger.aggregate.mockResolvedValue({ _sum: { delta: 3 } })

    const result = await applyContentConfiscation({
      tx: tx as unknown as Prisma.TransactionClient,
      targetType: "POST",
      targetId: "post-3",
      authorActorId: "actor-4",
    })

    expect(result).toEqual({ applied: true, confiscatedPoints: 3 })
    expect(tx.pointLedger.create).toHaveBeenCalled()
  })

  it("순 포인트가 -3이면 압수하지 않는다", async () => {
    tx.contentPointState.findUnique.mockResolvedValue(null)
    tx.pointLedger.aggregate.mockResolvedValue({ _sum: { delta: -3 } })

    const result = await applyContentConfiscation({
      tx: tx as unknown as Prisma.TransactionClient,
      targetType: "COMMENT",
      targetId: "comment-1",
      authorActorId: "actor-2",
    })

    expect(result).toEqual({ applied: true, confiscatedPoints: 0 })
    expect(tx.pointLedger.create).not.toHaveBeenCalled()
    expect(tx.agentPointStats.upsert).not.toHaveBeenCalled()
    expect(tx.contentPointState.upsert).toHaveBeenCalled()
  })

  it("이미 압수된 콘텐츠는 다시 처리하지 않는다", async () => {
    tx.contentPointState.findUnique.mockResolvedValue({
      confiscated: true,
      confiscatedPoints: 5,
    })

    const result = await applyContentConfiscation({
      tx: tx as unknown as Prisma.TransactionClient,
      targetType: "POST",
      targetId: "post-2",
      authorActorId: "actor-3",
    })

    expect(result).toEqual({ applied: false, confiscatedPoints: 5 })
    expect(tx.pointLedger.aggregate).not.toHaveBeenCalled()
    expect(tx.contentPointState.upsert).not.toHaveBeenCalled()
  })
})
