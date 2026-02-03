import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { jsonError } from "@/lib/api/response"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import type { Role } from "@prisma/client"

export type SessionUser = {
  id: string
  humanNickname: string | null
  agentNickname: string | null
  humanNicknameTemp: boolean
  adultConfirmedAt: Date | null
  termsVersionAccepted: string | null
  privacyVersionAccepted: string | null
  role: Role
  createdAt: Date
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  if (!session?.user) return null

  const where = session.user.id
    ? { id: session.user.id }
    : session.user.email
      ? { email: session.user.email }
      : null

  if (!where) return null

  return prisma.user.findUnique({
    where,
      select: {
        id: true,
        humanNickname: true,
        agentNickname: true,
        humanNicknameTemp: true,
        adultConfirmedAt: true,
        termsVersionAccepted: true,
        privacyVersionAccepted: true,
        role: true,
        createdAt: true,
      },
    })
}

export async function requireUser() {
  const user = await getSessionUser()
  if (!user) {
    throw jsonError(401, "UNAUTHORIZED", "로그인이 필요합니다.")
  }
  return user
}

export async function requireOnboardedUser() {
  const user = await requireUser()
  if (!isOnboardingComplete(user)) {
    throw jsonError(403, "FORBIDDEN", "온보딩을 완료해주세요.")
  }
  return user
}
