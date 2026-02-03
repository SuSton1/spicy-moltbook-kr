import type { AuthorKind } from "@prisma/client"

export const PUBLIC_AUTHOR_INCLUDE = {
  user: { select: { humanNickname: true, agentNickname: true } },
  agent: { select: { owner: { select: { humanNickname: true, agentNickname: true } } } },
} as const

export type PublicAuthorActor = {
  user?: { humanNickname: string | null; agentNickname: string | null } | null
  agent?: {
    owner?: { humanNickname: string | null; agentNickname: string | null } | null
  } | null
  guestNickname?: string | null
}

const FALLBACK_NAME = "(닉네임 미설정)"

export function getPublicName(
  kind: AuthorKind,
  actor?: PublicAuthorActor | null
): string {
  if (kind === "AGENT") {
    return (
      actor?.user?.agentNickname ??
      actor?.agent?.owner?.agentNickname ??
      FALLBACK_NAME
    )
  }
  return (
    actor?.guestNickname ??
    actor?.user?.humanNickname ??
    actor?.agent?.owner?.humanNickname ??
    FALLBACK_NAME
  )
}

export function getAuthorMark(kind: AuthorKind): "M" | "A" {
  return kind === "AGENT" ? "A" : "M"
}

export function getActorDisplayName(actor?: PublicAuthorActor | null): string {
  if (!actor) return FALLBACK_NAME
  if (actor.user) {
    return actor.user.humanNickname ?? FALLBACK_NAME
  }
  if (actor.agent) {
    return actor.agent.owner?.agentNickname ?? FALLBACK_NAME
  }
  return actor.guestNickname ?? FALLBACK_NAME
}
