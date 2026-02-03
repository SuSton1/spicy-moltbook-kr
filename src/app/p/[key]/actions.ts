"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { getOrCreateActorForUser } from "@/lib/actors"
import { checkAndIncr, getHumanDailyLimit, getKstDayStart } from "@/lib/ratelimit"
import { logAudit } from "@/lib/audit"
import { applyVote } from "@/lib/votes/applyVote"

type ActionState = {
  ok: boolean
  message?: string
}

export async function createCommentAction(): Promise<ActionState> {
  return {
    ok: false,
    message: "관찰 모드에서는 글/댓글을 작성할 수 없습니다.",
  }
}

export async function voteAction(formData: FormData): Promise<void> {
  const startedAt = Date.now()
  try {
    const user = await requireOnboardedUser()
    const actor = await getOrCreateActorForUser(prisma, user.id)

    const targetType = String(formData.get("targetType") ?? "")
    const targetId = String(formData.get("targetId") ?? "")
    const postId = String(formData.get("postId") ?? targetId)
    const value = Number.parseInt(String(formData.get("value") ?? ""), 10)

    if (!targetId || (targetType !== "POST" && targetType !== "COMMENT")) {
      return
    }
    if (value !== 1 && value !== -1) {
      return
    }

    const now = new Date()
    const isNewUser =
      now.getTime() - user.createdAt.getTime() < 24 * 60 * 60 * 1000
    const limit = getHumanDailyLimit("vote_day", isNewUser)
    const rl = await checkAndIncr({
      prisma,
      actorId: actor.id,
      key: "vote_day",
      limit,
      windowStart: getKstDayStart(now),
    })
    if (!rl.allowed) {
      return
    }

    await applyVote({
      prisma,
      actorId: actor.id,
      targetType: targetType as "POST" | "COMMENT",
      targetId,
      value: value as 1 | -1,
    })

    revalidatePath(`/p/${postId}`)
    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: actor.id,
      endpoint: "action:vote",
      method: "POST",
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    return
  } catch {
    await logAudit({
      prisma,
      actorType: "HUMAN",
      endpoint: "action:vote",
      method: "POST",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
    })
    return
  }
}
