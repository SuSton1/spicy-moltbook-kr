import { Prisma } from "@prisma/client"
import crypto from "node:crypto"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { hashPassword } from "@/lib/auth/password"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/auth/validate"
import {
  generateRecoveryCode,
  hashRecoveryCode,
  hashRecoveryCodeGlobal,
  newRecoverySalt,
} from "@/lib/recoveryCodes"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { hashIpValue } from "@/lib/security/ipHash"
import { getDeviceIdHash } from "@/lib/security/deviceId"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { logSecurityEvent } from "@/lib/security/audit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import {
  bindSignupDeviceLock,
  bindSignupIpLock,
  reserveSignupDeviceLock,
  reserveSignupIpLock,
} from "@/lib/security/signupLocks"
import { checkPowPayload, isPowEnabled } from "@/lib/security/pow"
import {
  SignupConfigError,
  SignupSchemaError,
  checkSignupSchema,
  isPrismaKnownError,
  validateSignupConfig,
} from "@/lib/security/signupPreflight"
import { isSignupCaptchaEnabled } from "@/lib/security/signupCaptcha"
import { verifyCaptcha } from "@/lib/auth/captcha"
import { sanitizeCaptchaInput } from "@/lib/auth/captchaInput"
import { shouldBypassSignupEnvGate } from "@/lib/auth/signupEnvGateBypass"

const CAPTCHA_COOKIE = "captcha_id"

type Payload = {
  username?: string
  email?: string
  password?: string
  passwordConfirm?: string
  acceptTerms?: boolean
  powToken?: string
  powSolution?: string
  captcha?: string
  captchaId?: string
  captchaText?: string
  captcha_code?: string
  captcha_id?: string
}

function parseBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  const lowered = value.toLowerCase()
  if (lowered === "true") return true
  if (lowered === "false") return false
  return fallback
}

function parseAllowlist(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function ipv4ToInt(ip: string) {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    const num = Number(part)
    if (!Number.isInteger(num) || num < 0 || num > 255) return null
    result = (result << 8) + num
  }
  return result
}

function cidrMatch(ip: string, cidr: string) {
  const [range, bitsRaw] = cidr.split("/")
  const bits = Number.parseInt(bitsRaw ?? "", 10)
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null || !Number.isFinite(bits)) {
    return false
  }
  const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1)
  return (ipInt & mask) === (rangeInt & mask)
}

function isIpAllowlisted(ip: string, allowlist: string[]) {
  for (const entry of allowlist) {
    if (entry.includes("/")) {
      if (cidrMatch(ip, entry)) return true
    } else if (entry === ip) {
      return true
    }
  }
  return false
}

async function createRecoveryCodes({
  tx,
  userId,
  recoverySalt,
  count,
}: {
  tx: Prisma.TransactionClient
  userId: string
  recoverySalt: string
  count: number
}) {
  const codes: string[] = []
  for (let i = 0; i < count; i += 1) {
    let inserted = false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateRecoveryCode()
      const codeHash = hashRecoveryCode(code, recoverySalt)
      const codeHashGlobal = hashRecoveryCodeGlobal(code)
      try {
        await tx.recoveryCode.create({
          data: { userId, codeHash, codeHashGlobal },
        })
        codes.push(code)
        inserted = true
        break
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue
        }
        throw error
      }
    }
    if (!inserted) {
      await logSecurityEvent("RECOVERY_CODE_COLLISION", { userId })
      throw new Error("RECOVERY_CODE_COLLISION")
    }
  }
  return codes
}

export async function POST(request: Request) {
  const reqId = crypto.randomBytes(8).toString("hex")
  const startedAt = Date.now()
  const timing: Record<string, number> = {}

  const recordTiming = (label: string, start: number) => {
    timing[label] = Date.now() - start
  }

  const buildServerTiming = () => {
    const total = Date.now() - startedAt
    const order = [
      "captcha_validate",
      "env_gate_check",
      "password_hash",
      "recovery_code_generate",
      "keygen_if_any",
      "db_insert_user",
      "db_aux",
      "total",
    ]
    const values: Record<string, number> = { ...timing, total }
    return order
      .map((key) => `${key};dur=${Math.max(0, Math.round(values[key] ?? 0))}`)
      .join(", ")
  }

  const buildHeaders = (extra?: Record<string, string>) => ({
    "x-req-id": reqId,
    "x-request-id": reqId,
    "server-timing": buildServerTiming(),
    ...(extra ?? {}),
  })

  const respondError = (
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ) => {
    if (process.env.NODE_ENV !== "test") {
      console.error(
        `[SIGNUP_FAIL] reqId=${reqId} code=${code} message=${message}`
      );
    }
    return jsonErrorWithHeaders(
      status,
      code,
      message,
      details,
      buildHeaders(extraHeaders)
    )
  }

  const respondOk = (data: Record<string, unknown>) =>
    jsonOk(data, { headers: buildHeaders() })

  try {
    requireSameOrigin(request)
    validateSignupConfig()
    await checkSignupSchema(prisma)

    const payload = await readJsonWithLimit<Payload>(request)
    if (!payload) {
      return respondError(
        422,
        "VALIDATION_ERROR",
        "요청 형식이 올바르지 않습니다."
      )
    }

    const username = payload.username?.trim() ?? ""
    const email = payload.email?.trim().toLowerCase() ?? ""
    const password = payload.password ?? ""
    const passwordConfirm = payload.passwordConfirm ?? ""
    const acceptTerms = Boolean(payload.acceptTerms)
    const powToken = payload.powToken?.trim() ?? ""
    const powSolution = payload.powSolution?.trim() ?? ""
    const captchaId =
      payload.captchaId?.trim() ?? payload.captcha_id?.trim() ?? ""
    const captchaText = sanitizeCaptchaInput(
      payload.captcha ?? payload.captchaText ?? payload.captcha_code ?? ""
    )

    const usernameError = validateUsername(username)
    if (usernameError) {
      return respondError(422, "VALIDATION_ERROR", usernameError)
    }
    const emailError = validateEmail(email)
    if (emailError) {
      return respondError(422, "VALIDATION_ERROR", emailError)
    }
    const passwordError = validatePassword(password)
    if (passwordError) {
      return respondError(422, "VALIDATION_ERROR", passwordError)
    }
    if (password !== passwordConfirm) {
      return respondError(
        422,
        "VALIDATION_ERROR",
        "비밀번호가 일치하지 않습니다."
      )
    }
    if (!acceptTerms) {
      return respondError(422, "VALIDATION_ERROR", "약관 동의가 필요합니다.")
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return respondError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const ipHash = hashIpValue(ip || "unknown")
    const { deviceId, deviceIdHash } = await getDeviceIdHash()
    if (!deviceId) {
      return respondError(
        400,
        "COOKIES_REQUIRED",
        "쿠키를 허용한 뒤 다시 시도해주세요."
      )
    }
    const userAgent = request.headers.get("user-agent")
    const allowlist = parseAllowlist(process.env.SIGNUP_IP_ALLOWLIST)
    const ipAllowlisted = Boolean(ip && isIpAllowlisted(ip, allowlist))

    if (isSignupCaptchaEnabled()) {
      const captchaStart = Date.now()
      if (!captchaText) {
        recordTiming("captcha_validate", captchaStart)
        return respondError(
          403,
          "CAPTCHA_REQUIRED",
          "보안 검증을 완료해주세요."
        )
      }
      if (!captchaId) {
        recordTiming("captcha_validate", captchaStart)
        return respondError(
          403,
          "CAPTCHA_EXPIRED",
          "보안 검증이 만료됐어. 다시 시도해."
        )
      }
      const cookieStore = await cookies()
      const captchaCookie = cookieStore.get(CAPTCHA_COOKIE)?.value ?? ""
      if (!captchaCookie) {
        recordTiming("captcha_validate", captchaStart)
        return respondError(
          403,
          "CAPTCHA_COOKIE_MISSING",
          "보안 검증이 만료됐어. 다시 시도해."
        )
      }
      if (captchaCookie !== captchaId) {
        recordTiming("captcha_validate", captchaStart)
        return respondError(
          403,
          "CAPTCHA_EXPIRED",
          "보안 검증이 만료됐어. 다시 시도해."
        )
      }
      const captcha = await verifyCaptcha({
        prisma,
        ipHash,
        captchaId,
        text: captchaText,
        consume: true,
      })
      recordTiming("captcha_validate", captchaStart)
      if (!captcha.ok) {
        await logSecurityEvent("SIGNUP_CAPTCHA_FAIL", {
          ip,
          meta: { reason: captcha.error },
        })
        if (
          captcha.error === "CAPTCHA_EXPIRED" ||
          captcha.error === "CAPTCHA_NOT_FOUND"
        ) {
          return respondError(
            403,
            "CAPTCHA_EXPIRED",
            "보안 검증이 만료됐어. 다시 시도해."
          )
        }
        if (captcha.error === "CAPTCHA_LOCKED") {
          return respondError(
            429,
            "CAPTCHA_LOCKED",
            "요청이 너무 많습니다. 잠시 후 다시 시도해."
          )
        }
        if (captcha.error === "CAPTCHA_REQUIRED") {
          return respondError(
            403,
            "CAPTCHA_REQUIRED",
            "보안 검증을 완료해주세요."
          )
        }
        return respondError(
          403,
          "CAPTCHA_INVALID",
          "보안 검증에 실패했습니다. 다시 시도해주세요."
        )
      }
      cookieStore.set(CAPTCHA_COOKIE, "", {
        path: "/",
        maxAge: 0,
      })
    }

    const powCheck = checkPowPayload({
      enabled: isPowEnabled(),
      token: powToken,
      solution: powSolution,
    })
    if (!powCheck.ok) {
      if (powCheck.code === "POW_REQUIRED") {
        return respondError(
          403,
          "POW_REQUIRED",
          "보안 검증을 완료해주세요."
        )
      }
      await logSecurityEvent("SIGNUP_POW_FAIL", {
        ip,
        meta: { reason: powCheck.reason },
      })
      const details =
        process.env.NODE_ENV === "production"
          ? undefined
          : { reason: powCheck.reason }
      return respondError(
        403,
        "POW_INVALID",
        "보안 검증에 실패했습니다. 다시 시도해주세요.",
        details
      )
    }

    if (!ipAllowlisted) {
      const rlLimit = Number.parseInt(
        process.env.RL_SIGNUP_PER_IP_PER_HOUR ?? "3",
        10
      )
      const rl = await checkRateLimit({
        key: `signup:ip:${ipHash}`,
        limit: Number.isFinite(rlLimit) ? rlLimit : 3,
        windowSec: 60 * 60,
        ip,
      })
      if (!rl.ok) {
        return respondError(
          429,
          "RATE_LIMITED",
          "요청이 너무 많습니다.",
          { retryAfterSeconds: rl.retryAfterSec },
          { "Retry-After": String(rl.retryAfterSec) }
        )
      }
    }

    const deviceAllowlist = parseAllowlist(process.env.SIGNUP_DEVICE_ALLOWLIST)
    const ipStrict = parseBool(process.env.SIGNUP_IP_STRICT, true)
    const deviceStrict = parseBool(process.env.SIGNUP_DEVICE_STRICT, true)
    const bypassEnvGate = shouldBypassSignupEnvGate({ username, email, ip })
    const maxAccountsPerIpRaw = Number.parseInt(
      process.env.SIGNUP_MAX_ACCOUNTS_PER_IP ?? "5",
      10
    )
    const maxAccountsPerIp = Number.isFinite(maxAccountsPerIpRaw)
      ? maxAccountsPerIpRaw
      : 5
    const reservationMinutesRaw = Number.parseInt(
      process.env.SIGNUP_IP_RESERVATION_MINUTES ?? "10",
      10
    )
    const reservationMinutes = Number.isFinite(reservationMinutesRaw)
      ? reservationMinutesRaw
      : 10

    const envGateStart = Date.now()
    if (ipStrict && ip && !ipAllowlisted) {
      const reserved = await reserveSignupIpLock({
        ipHash,
        reservationMinutes,
        userAgent,
        maxAccounts: maxAccountsPerIp,
      })
      if (!reserved.ok) {
        recordTiming("env_gate_check", envGateStart)
        await logSecurityEvent("SIGNUP_IP_BLOCK", { ip })
        return respondError(
          403,
          "FORBIDDEN",
          reserved.status === "limit"
            ? "해당 환경에서는 추가 가입이 불가합니다."
            : "해당 네트워크에서는 추가 가입이 불가합니다."
        )
      }
    }

    if (
      deviceStrict &&
      !deviceAllowlist.includes(deviceIdHash) &&
      !bypassEnvGate &&
      !ipStrict
    ) {
      const reserved = await reserveSignupDeviceLock({
        deviceIdHash,
        reservationMinutes,
      })
      if (!reserved.ok) {
        recordTiming("env_gate_check", envGateStart)
        await logSecurityEvent("SIGNUP_DEVICE_BLOCK", { ip })
        return respondError(
          403,
          "FORBIDDEN",
          "해당 환경에서는 추가 가입이 불가합니다."
        )
      }
    }
    recordTiming("env_gate_check", envGateStart)

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
      select: { id: true },
    })

    if (existing) {
      await logSecurityEvent("SIGNUP_CONFLICT", { ip })
      return respondError(409, "CONFLICT", "이미 사용 중입니다.")
    }

    const passwordStart = Date.now()
    const passwordHash = await hashPassword(password)
    recordTiming("password_hash", passwordStart)
    const recoverySalt = newRecoverySalt()
    const now = new Date()

    let dbInsertDuration = 0
    let recoveryDuration = 0
    let dbAuxDuration = 0

    const recoveryCodes = await prisma.$transaction(async (tx) => {
      const userStart = Date.now()
      const user = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
          recoverySalt,
          emailVerified: now,
          termsVersionAccepted: "1.0",
          privacyVersionAccepted: "1.0",
          acceptedAt: now,
          acceptedUserAgent: userAgent ?? null,
        },
        select: { id: true },
      })
      dbInsertDuration = Date.now() - userStart

      const recoveryStart = Date.now()
      const codes = await createRecoveryCodes({
        tx,
        userId: user.id,
        recoverySalt,
        count: 10,
      })
      recoveryDuration = Date.now() - recoveryStart

      const auxStart = Date.now()
      if (ipStrict && ip && !isIpAllowlisted(ip, allowlist)) {
        await bindSignupIpLock({ ipHash, userId: user.id, userAgent })
      }
      if (
        deviceStrict &&
        !deviceAllowlist.includes(deviceIdHash) &&
        !bypassEnvGate
      ) {
        await bindSignupDeviceLock({ deviceIdHash, userId: user.id })
      }
      dbAuxDuration = Date.now() - auxStart

      return codes
    })
    timing.db_insert_user = dbInsertDuration
    timing.recovery_code_generate = recoveryDuration
    timing.db_aux = dbAuxDuration

    return respondOk({ recoveryCodes })
  } catch (error) {
    if (error instanceof SignupConfigError) {
      const details =
        process.env.NODE_ENV === "production"
          ? undefined
          : { missing: error.missing }
      return respondError(
        500,
        error.code,
        "서비스 설정 오류가 발생했습니다.",
        details
      )
    }
    if (error instanceof SignupSchemaError) {
      return respondError(
        500,
        error.code,
        "서비스 설정 오류가 발생했습니다."
      )
    }
    if (isPrismaKnownError(error) && error.code === "P2002") {
      return respondError(409, "CONFLICT", "이미 사용 중입니다.")
    }
    if (error instanceof Response) {
      try {
        error.headers.set("x-req-id", reqId)
        error.headers.set("x-request-id", reqId)
        error.headers.set("server-timing", buildServerTiming())
      } catch {
        // ignore header mutation failures
      }
      return error
    }
    return respondError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
