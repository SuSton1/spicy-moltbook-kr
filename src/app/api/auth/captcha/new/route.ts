import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { createCaptcha } from "@/lib/auth/captcha"
import { checkAndIncrIp, getKstHourStart } from "@/lib/ipRateLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { hashIpValue } from "@/lib/security/ipHash"
import { getDeviceIdHash } from "@/lib/security/deviceId"

const CAPTCHA_COOKIE = "captcha_id"

const CAPTCHA_NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: Request) {
  const { ip } = getClientIp(request)
  const ipHash = hashIpValue(ip || "unknown")
  const now = new Date()
  const rl = await checkAndIncrIp({
    prisma,
    ipHash,
    key: "captcha_new",
    limit: 20,
    windowStart: getKstHourStart(now),
  })

  if (!rl.allowed) {
    return jsonError(429, "RATE_LIMITED", "요청이 너무 많습니다.")
  }

  const captcha = await createCaptcha(prisma, ipHash)
  const ttlSeconds = Math.max(
    60,
    Math.floor((captcha.expiresAt.getTime() - Date.now()) / 1000)
  )
  const store = await cookies()
  store.set(CAPTCHA_COOKIE, captcha.captchaId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
  })
  await getDeviceIdHash()
  return jsonOk(
    { captchaId: captcha.captchaId, svg: captcha.svg },
    { headers: CAPTCHA_NO_CACHE_HEADERS }
  )
}
