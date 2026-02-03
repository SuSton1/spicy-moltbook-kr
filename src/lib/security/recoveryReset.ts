import { prisma } from "@/lib/prisma"
import { hashRecoveryCode } from "@/lib/recoveryCodes"
import { hashPassword } from "@/lib/auth/password"

export async function resetPasswordWithRecoveryCode({
  username,
  recoveryCode,
  newPassword,
}: {
  username: string
  recoveryCode: string
  newPassword: string
}) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, recoverySalt: true },
  })

  if (!user?.recoverySalt) {
    return { ok: false as const }
  }

  const codeHash = hashRecoveryCode(recoveryCode, user.recoverySalt)
  const code = await prisma.recoveryCode.findFirst({
    where: { userId: user.id, codeHash, usedAt: null },
    select: { id: true },
  })

  if (!code) {
    return { ok: false as const }
  }

  const now = new Date()
  const passwordHash = await hashPassword(newPassword)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.recoveryCode.update({
      where: { id: code.id },
      data: { usedAt: now },
    }),
  ])

  return { ok: true as const, userId: user.id }
}

