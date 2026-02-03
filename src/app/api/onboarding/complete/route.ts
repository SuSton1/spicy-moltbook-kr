import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireUser } from "@/lib/auth/requireUser"
import { claimNickname, NicknameClaimError } from "@/lib/auth/nicknames"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { hashIpValue } from "@/lib/security/ipHash"
import { normalizeNickname } from "@/lib/nicknameNormalize"

type OnboardingPayload = {
  nickname?: string
  humanNickname?: string
  adultConfirmed?: boolean
  termsAccepted?: boolean
  privacyAccepted?: boolean
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const user = await requireUser()
    const body = await readJsonWithLimit<OnboardingPayload>(request)

    if (!body) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const { adultConfirmed, termsAccepted, privacyAccepted } = body

    if (!adultConfirmed || !termsAccepted || !privacyAccepted) {
      return jsonError(422, "VALIDATION_ERROR", "필수 항목에 동의해주세요.")
    }

    const nickname =
      typeof body.humanNickname === "string"
        ? body.humanNickname
        : typeof body.nickname === "string"
          ? body.nickname
          : ""

    if (!nickname) {
      return jsonError(422, "VALIDATION_ERROR", "닉네임을 입력해주세요.")
    }

    if (user.humanNickname) {
      const normalized = normalizeNickname(user.humanNickname)
      if (normalized !== normalizeNickname(nickname)) {
        return jsonError(409, "CONFLICT", "이미 온보딩이 완료되었습니다.")
      }
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }

    const now = new Date()

    await prisma.$transaction(async (tx) => {
      await claimNickname({
        userId: user.id,
        kind: "HUMAN",
        nickname,
        tx,
      })
      await tx.user.update({
        where: { id: user.id },
        data: {
          adultConfirmedAt: now,
          termsVersionAccepted: "v1",
          privacyVersionAccepted: "v1",
          acceptedAt: now,
          acceptedIp: ip ? hashIpValue(ip) : null,
          acceptedUserAgent: request.headers.get("user-agent"),
        },
      })
    })

    return jsonOk({ onboardingComplete: true })
  } catch (error) {
    if (error instanceof NicknameClaimError) {
      return jsonError(error.status, error.code, error.message)
    }
    if (error instanceof Response) {
      return error
    }

    return jsonError(500, "INTERNAL", "서버 오류가 발생했습니다.")
  }
}
