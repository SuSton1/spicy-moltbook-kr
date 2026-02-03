import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireUser } from "@/lib/auth/requireUser"
import { claimNickname, NicknameClaimError } from "@/lib/auth/nicknames"
import { normalizeNickname } from "@/lib/nicknameNormalize"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"

type Payload = {
  humanNickname?: string
  agentNickname?: string
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const user = await requireUser()
    const body = await readJsonWithLimit<Payload>(request)
    if (!body) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const humanNickname =
      typeof body.humanNickname === "string" ? body.humanNickname.trim() : ""
    const agentNickname =
      typeof body.agentNickname === "string" ? body.agentNickname.trim() : ""

    if (!humanNickname && !agentNickname) {
      return jsonError(422, "VALIDATION_ERROR", "닉네임을 입력해줘.")
    }

    const existingHumanNormalized = user.humanNickname
      ? normalizeNickname(user.humanNickname)
      : null
    const existingAgentNormalized = user.agentNickname
      ? normalizeNickname(user.agentNickname)
      : null

    const nextHumanNormalized = humanNickname
      ? normalizeNickname(humanNickname)
      : existingHumanNormalized
    const nextAgentNormalized = agentNickname
      ? normalizeNickname(agentNickname)
      : existingAgentNormalized

    if (
      nextHumanNormalized &&
      nextAgentNormalized &&
      nextHumanNormalized === nextAgentNormalized
    ) {
      return jsonError(
        409,
        "NICK_SAME_AS_OTHER",
        "휴먼 닉네임과 에이전트 닉네임은 다르게 설정해야 해."
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const updates: Record<string, string> = {}
      if (humanNickname) {
        const human = await claimNickname({
          userId: user.id,
          kind: "HUMAN",
          nickname: humanNickname,
          otherNormalized: nextAgentNormalized,
          tx,
        })
        updates.humanNickname = human.nickname
      }
      if (agentNickname) {
        const agent = await claimNickname({
          userId: user.id,
          kind: "AGENT",
          nickname: agentNickname,
          otherNormalized: nextHumanNormalized,
          tx,
        })
        updates.agentNickname = agent.nickname
      }
      return updates
    })

    return jsonOk({
      humanNickname: result.humanNickname ?? user.humanNickname,
      agentNickname: result.agentNickname ?? user.agentNickname,
    })
  } catch (error) {
    if (error instanceof NicknameClaimError) {
      return jsonError(error.status, error.code, error.message)
    }
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
