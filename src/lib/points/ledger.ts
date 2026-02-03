import { Prisma } from "@prisma/client"
import type { PointLedgerReason, PrismaClient, VoteTargetType } from "@prisma/client"

type PointTx = Prisma.TransactionClient | PrismaClient

export function getVotePointDelta(
  previous: -1 | 0 | 1,
  next: -1 | 0 | 1
) {
  return next - previous
}

export async function recordPointDelta({
  tx,
  actorId,
  delta,
  targetType,
  targetId,
  reason,
}: {
  tx: PointTx
  actorId: string
  delta: number
  targetType: VoteTargetType
  targetId: string
  reason: PointLedgerReason
}) {
  if (!delta) return
  const isMissingTable =
    process.env.E2E_TEST === "1"
      ? (error: unknown) =>
          (error instanceof Prisma.PrismaClientKnownRequestError ||
            (typeof error === "object" &&
              error !== null &&
              "code" in error)) &&
          (error as { code?: string }).code === "P2021"
      : () => false
  try {
    await tx.pointLedger.create({
      data: {
        actorId,
        targetType,
        targetId,
        delta,
        reason,
      },
    })
    await tx.agentPointStats.upsert({
      where: { actorId },
      create: { actorId, points: delta },
      update: { points: { increment: delta } },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return
    }
    throw error
  }
}

export async function applyContentConfiscation({
  tx,
  targetType,
  targetId,
  authorActorId,
}: {
  tx: PointTx
  targetType: VoteTargetType
  targetId: string
  authorActorId: string
}) {
  const existing = await tx.contentPointState.findUnique({
    where: { targetType_targetId: { targetType, targetId } },
  })

  if (existing?.confiscated) {
    return { applied: false, confiscatedPoints: existing.confiscatedPoints }
  }

  const isMissingTable =
    process.env.E2E_TEST === "1"
      ? (error: unknown) =>
          (error instanceof Prisma.PrismaClientKnownRequestError ||
            (typeof error === "object" &&
              error !== null &&
              "code" in error)) &&
          (error as { code?: string }).code === "P2021"
      : () => false
  let contentNet = 0
  try {
    const aggregated = await tx.pointLedger.aggregate({
      where: { targetType, targetId, reason: "VOTE_CHANGE" },
      _sum: { delta: true },
    })
    contentNet = aggregated._sum.delta ?? 0
  } catch (error) {
    if (isMissingTable(error)) {
      return { applied: false, confiscatedPoints: 0 }
    }
    throw error
  }
  const confiscate = Math.max(0, contentNet)
  const now = new Date()

  await tx.contentPointState.upsert({
    where: { targetType_targetId: { targetType, targetId } },
    create: {
      targetType,
      targetId,
      confiscated: true,
      confiscatedAt: now,
      confiscatedPoints: confiscate,
    },
    update: {
      confiscated: true,
      confiscatedAt: now,
      confiscatedPoints: confiscate,
    },
  })

  if (confiscate > 0) {
    await recordPointDelta({
      tx,
      actorId: authorActorId,
      delta: -confiscate,
      targetType,
      targetId,
      reason: "DELETE_CONFISCATE",
    })
  }

  return { applied: true, confiscatedPoints: confiscate }
}
