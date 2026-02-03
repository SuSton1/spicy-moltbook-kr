import { Prisma, NicknameKind } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { validateNickname } from "@/lib/nickname"

export class NicknameClaimError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 422) {
    super(message)
    this.code = code
    this.status = status
  }
}

type ClaimInput = {
  userId: string
  kind: NicknameKind
  nickname: string
  otherNormalized?: string | null
  tx?: Prisma.TransactionClient
}

const isUniqueError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002"
  }
  if (typeof error === "object" && error && "code" in error) {
    return (error as { code?: string }).code === "P2002"
  }
  return false
}

export async function claimNickname({
  userId,
  kind,
  nickname,
  otherNormalized,
  tx,
}: ClaimInput) {
  const client = tx ?? prisma
  const validation = validateNickname(nickname)
  if (!validation.ok) {
    throw new NicknameClaimError(
      validation.code,
      validation.message,
      validation.code === "NICK_RESERVED" ? 422 : 422
    )
  }

  if (otherNormalized && validation.normalized === otherNormalized) {
    throw new NicknameClaimError(
      "NICK_SAME_AS_OTHER",
      "휴먼 닉네임과 에이전트 닉네임은 다르게 설정해야 해.",
      409
    )
  }

  const existingByKind = await client.nicknameRegistry.findUnique({
    where: { userId_kind: { userId, kind } },
  })

  if (existingByKind?.normalizedNickname === validation.normalized) {
    const data =
      kind === "HUMAN"
        ? { humanNickname: validation.original, humanNicknameTemp: false }
        : { agentNickname: validation.original }
    await client.user.update({ where: { id: userId }, data })
    return { nickname: validation.original, normalized: validation.normalized }
  }

  const existingNormalized = await client.nicknameRegistry.findUnique({
    where: { normalizedNickname: validation.normalized },
  })

  if (existingNormalized) {
    if (existingNormalized.userId !== userId) {
      throw new NicknameClaimError(
        "NICK_TAKEN",
        "이미 사용 중인 닉네임입니다.",
        409
      )
    }
    if (existingNormalized.kind !== kind) {
      throw new NicknameClaimError(
        "NICK_SAME_AS_OTHER",
        "휴먼 닉네임과 에이전트 닉네임은 다르게 설정해야 해.",
        409
      )
    }
  }

  try {
    if (existingByKind) {
      await client.nicknameRegistry.update({
        where: { id: existingByKind.id },
        data: {
          nickname: validation.original,
          normalizedNickname: validation.normalized,
        },
      })
    } else {
      await client.nicknameRegistry.create({
        data: {
          userId,
          kind,
          nickname: validation.original,
          normalizedNickname: validation.normalized,
        },
      })
    }
  } catch (error) {
    if (isUniqueError(error)) {
      throw new NicknameClaimError(
        "NICK_TAKEN",
        "이미 사용 중인 닉네임입니다.",
        409
      )
    }
    throw error
  }

  const data =
    kind === "HUMAN"
      ? { humanNickname: validation.original, humanNicknameTemp: false }
      : { agentNickname: validation.original }
  await client.user.update({ where: { id: userId }, data })

  return { nickname: validation.original, normalized: validation.normalized }
}
