import type { PrismaClient } from "@prisma/client"
import { jsonError } from "@/lib/api/response"
import { computeHotScore, computeDiscussedScore } from "@/lib/scores"
import { assertNotBanned } from "@/lib/ban"
import { toggleVote, type VoteValue } from "@/lib/votes/toggleVote"
import { getVotePointDelta, recordPointDelta } from "@/lib/points/ledger"

export type VoteTargetType = "POST" | "COMMENT"

export async function applyVote({
  prisma,
  actorId,
  targetType,
  targetId,
  value,
}: {
  prisma: PrismaClient
  actorId: string
  targetType: VoteTargetType
  targetId: string
  value: VoteValue
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vote.findUnique({
      where: {
        voterActorId_targetType_targetId: {
          voterActorId: actorId,
          targetType,
          targetId,
        },
      },
    })

    const existingValue =
      existing?.value === 1 || existing?.value === -1 ? existing.value : null
    const toggle = toggleVote(existingValue, value)
    const pointDelta = getVotePointDelta(existingValue ?? 0, toggle.nextValue)

    const applyVoteChange = async () => {
      if (toggle.action === "create") {
        await tx.vote.create({
          data: {
            voterActorId: actorId,
            targetType,
            targetId,
            value,
          },
        })
      } else if (toggle.action === "update") {
        if (!existing) {
          throw new Error("NOT_FOUND")
        }
        await tx.vote.update({
          where: { id: existing.id },
          data: { value },
        })
      } else {
        if (!existing) {
          throw new Error("NOT_FOUND")
        }
        await tx.vote.delete({
          where: { id: existing.id },
        })
      }
    }

    if (targetType === "POST") {
      const post = await tx.post.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          boardId: true,
          authorActorId: true,
          status: true,
          upCount: true,
          downCount: true,
          commentCount: true,
          createdAt: true,
          isBest: true,
          bestAt: true,
        },
      })
      if (!post) throw new Error("NOT_FOUND")
      if (post.status !== "VISIBLE") {
        throw jsonError(
          409,
          "TARGET_FROZEN",
          "삭제되었거나 숨김 처리된 글에는 투표할 수 없습니다."
        )
      }
      if (post.authorActorId === actorId) {
        throw jsonError(403, "SELF_VOTE", "자신의 글에는 투표할 수 없습니다.")
      }

      await assertNotBanned({ prisma: tx, actorId, boardId: post.boardId })
      await applyVoteChange()

      if (toggle.deltaUp === 0 && toggle.deltaDown === 0) {
        return { up: post.upCount, down: post.downCount, myVote: toggle.nextValue }
      }

      const nextUp = post.upCount + toggle.deltaUp
      const nextDown = post.downCount + toggle.deltaDown
      const hotScore = computeHotScore({
        up: nextUp,
        down: nextDown,
        createdAt: post.createdAt,
      })
      const discussedScore = computeDiscussedScore({
        commentCount: post.commentCount,
        up: nextUp,
        down: nextDown,
      })
      const shouldPromote = !post.isBest && nextUp >= 3
      const bestAt = shouldPromote ? post.bestAt ?? new Date() : post.bestAt

      await tx.post.update({
        where: { id: targetId },
        data: {
          upCount: nextUp,
          downCount: nextDown,
          hotScore,
          discussedScore,
          ...(shouldPromote ? { isBest: true, bestAt } : {}),
        },
      })

      if (pointDelta !== 0) {
        await recordPointDelta({
          tx,
          actorId: post.authorActorId,
          delta: pointDelta,
          targetType: "POST",
          targetId,
          reason: "VOTE_CHANGE",
        })
      }

      return { up: nextUp, down: nextDown, myVote: toggle.nextValue }
    }

    const comment = await tx.comment.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        postId: true,
        authorActorId: true,
        status: true,
        upCount: true,
        downCount: true,
      },
    })
    if (!comment) throw new Error("NOT_FOUND")
    if (comment.status !== "VISIBLE") {
      throw jsonError(
        409,
        "TARGET_FROZEN",
        "삭제되었거나 숨김 처리된 댓글에는 투표할 수 없습니다."
      )
    }
    if (comment.authorActorId === actorId) {
      throw jsonError(403, "SELF_VOTE", "자신의 댓글에는 투표할 수 없습니다.")
    }

    const post = await tx.post.findUnique({ where: { id: comment.postId } })
    if (post) {
      if (post.status !== "VISIBLE") {
        throw jsonError(
          409,
          "TARGET_FROZEN",
          "삭제되었거나 숨김 처리된 글에는 투표할 수 없습니다."
        )
      }
      await assertNotBanned({ prisma: tx, actorId, boardId: post.boardId })
    }

    await applyVoteChange()

    if (toggle.deltaUp === 0 && toggle.deltaDown === 0) {
      return {
        up: comment.upCount,
        down: comment.downCount,
        myVote: toggle.nextValue,
      }
    }

    const nextUp = comment.upCount + toggle.deltaUp
    const nextDown = comment.downCount + toggle.deltaDown

    await tx.comment.update({
      where: { id: targetId },
      data: {
        upCount: nextUp,
        downCount: nextDown,
      },
    })

    if (pointDelta !== 0) {
      await recordPointDelta({
        tx,
        actorId: comment.authorActorId,
        delta: pointDelta,
        targetType: "COMMENT",
        targetId,
        reason: "VOTE_CHANGE",
      })
    }

    return { up: nextUp, down: nextDown, myVote: toggle.nextValue }
  })
}
