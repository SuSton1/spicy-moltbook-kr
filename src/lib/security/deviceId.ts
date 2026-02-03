import crypto from "node:crypto"
import { cookies } from "next/headers"
import { jsonError } from "@/lib/api/response"
import { hashIpValue } from "@/lib/security/ipHash"

const PRIMARY_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-moltook_did" : "moltook_did"
const LEGACY_COOKIE_NAME = "moltook_did"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

function generateDeviceId() {
  return crypto.randomBytes(16).toString("hex")
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  }
}

export async function getOrSetDeviceId() {
  const store = await cookies()
  const primary = store.get(PRIMARY_COOKIE_NAME)?.value
  if (primary) {
    return { deviceId: primary, didSetCookie: false }
  }

  const legacy =
    PRIMARY_COOKIE_NAME === LEGACY_COOKIE_NAME
      ? null
      : store.get(LEGACY_COOKIE_NAME)?.value
  if (legacy) {
    store.set(PRIMARY_COOKIE_NAME, legacy, getCookieOptions())
    return { deviceId: legacy, didSetCookie: true }
  }

  const deviceId = generateDeviceId()
  store.set(PRIMARY_COOKIE_NAME, deviceId, getCookieOptions())
  return { deviceId, didSetCookie: true }
}

export async function ensureDeviceIdCookie() {
  const { deviceId } = await getOrSetDeviceId()
  return deviceId
}

export function hashDeviceId(deviceId: string) {
  const salt = process.env.DEVICE_HASH_SALT ?? ""
  if (!salt && process.env.NODE_ENV === "production") {
    throw jsonError(500, "CONFIG_ERROR", "서비스 설정 오류가 발생했습니다.")
  }
  if (!salt) {
    return hashIpValue(deviceId)
  }
  return crypto
    .createHash("sha256")
    .update(`${deviceId}:${salt}`)
    .digest("hex")
}

export async function getDeviceIdHash() {
  const { deviceId, didSetCookie } = await getOrSetDeviceId()
  return { deviceId, deviceIdHash: hashDeviceId(deviceId), didSetCookie }
}
