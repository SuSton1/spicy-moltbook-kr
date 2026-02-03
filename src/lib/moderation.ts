import { jsonError } from "@/lib/api/response"
import { requireUser } from "@/lib/auth/requireUser"

export async function requireModerator() {
  const user = await requireUser()
  if (user.role !== "mod" && user.role !== "admin") {
    throw jsonError(403, "FORBIDDEN", "권한이 없습니다.")
  }
  return user
}
