import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { validatePassword, validateUsername } from "@/lib/auth/validate"
import { resetPasswordWithRecoveryCode } from "@/lib/security/recoveryReset"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { checkAuthLock, clearAuthLock, recordAuthFailure } from "@/lib/security/authLock"
import { logSecurityEvent } from "@/lib/security/audit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"

type Payload = {
  username?: string
  recoveryCode?: string
  newPassword?: string
  newPasswordConfirm?: string
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const payload = await readJsonWithLimit<Payload>(request)
    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const username = payload.username?.trim() ?? ""
    const recoveryCode = payload.recoveryCode?.trim() ?? ""
    const newPassword = payload.newPassword ?? ""
    const newPasswordConfirm = payload.newPasswordConfirm ?? ""

    const usernameError = validateUsername(username)
    if (usernameError) {
      return jsonError(422, "VALIDATION_ERROR", usernameError)
    }
    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      return jsonError(422, "VALIDATION_ERROR", passwordError)
    }
    if (newPassword !== newPasswordConfirm) {
      return jsonError(422, "VALIDATION_ERROR", "비밀번호가 일치하지 않습니다.")
    }
    if (!recoveryCode) {
      return jsonError(422, "VALIDATION_ERROR", "복구코드를 입력해주세요.")
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }

    const ipLimit = Number.parseInt(process.env.RL_RESET_PER_IP_PER_MIN ?? "3", 10)
    const userLimit = Number.parseInt(
      process.env.RL_RESET_PER_USER_PER_HOUR ?? "5",
      10
    )
    const ipKey = hashIpValue(ip || "unknown")
    const rlIp = await checkRateLimit({
      key: `reset:ip:${ipKey}`,
      limit: Number.isFinite(ipLimit) ? ipLimit : 3,
      windowSec: 60,
      ip,
    })
    if (!rlIp.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다.",
        { retryAfterSeconds: rlIp.retryAfterSec },
        { "Retry-After": String(rlIp.retryAfterSec) }
      )
    }
    const rlUser = await checkRateLimit({
      key: `reset:user:${username}`,
      limit: Number.isFinite(userLimit) ? userLimit : 5,
      windowSec: 60 * 60,
      ip,
    })
    if (!rlUser.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다.",
        { retryAfterSeconds: rlUser.retryAfterSec },
        { "Retry-After": String(rlUser.retryAfterSec) }
      )
    }

    const lock = await checkAuthLock(`reset:${username}`)
    if (lock.locked) {
      return jsonErrorWithHeaders(
        429,
        "LOCKED",
        "잠시 후 다시 시도해주세요.",
        { retryAfterSeconds: lock.retryAfterSec },
        { "Retry-After": String(lock.retryAfterSec) }
      )
    }

    const result = await resetPasswordWithRecoveryCode({
      username,
      recoveryCode,
      newPassword,
    })
    if (!result.ok) {
      await recordAuthFailure(`reset:${username}`)
      await logSecurityEvent("RESET_FAIL", { ip })
      return jsonError(422, "INVALID", "정보를 확인해주세요.")
    }

    await clearAuthLock(`reset:${username}`)
    return jsonOk({ ok: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
