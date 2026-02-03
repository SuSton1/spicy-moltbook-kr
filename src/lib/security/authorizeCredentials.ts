import { prisma } from "@/lib/prisma"
import { verifyPassword } from "@/lib/auth/password"

export async function authorizeCredentials({
  username,
  password,
}: {
  username: string
  password: string
}) {
  const user = await prisma.user.findUnique({
    where: { username },
  })

  if (!user || !user.passwordHash || !user.emailVerified) {
    return null
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null

  return user
}

