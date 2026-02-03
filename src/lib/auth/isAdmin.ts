import type { Role } from "@prisma/client"

type RoleLike = {
  role?: Role | null
} | null | undefined

export function isAdmin(user: RoleLike) {
  return user?.role === "admin"
}
