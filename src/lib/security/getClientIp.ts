import { jsonError } from "@/lib/api/response"

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/

type IpSource =
  | "unknown"
  | "x-forwarded-for"
  | "x-real-ip"
  | "cf-connecting-ip"
  | "host-mismatch"
  | "invalid"

function isLikelyIpv6(ip: string) {
  return ip.includes(":")
}

function normalizeIp(raw: string) {
  if (raw.startsWith("::ffff:")) {
    return raw.slice(7)
  }
  return raw
}

function hostMatchesOrigin(host: string, origin: string) {
  if (!host || !origin) return false
  try {
    const originHost = new URL(origin).host
    return host === originHost
  } catch {
    return false
  }
}

export function getClientIp(request: Request) {
  const trustProxy = (process.env.TRUST_PROXY ?? "").toLowerCase() === "true"
  const appOrigin = process.env.APP_ORIGIN ?? ""
  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""

  if (process.env.NODE_ENV === "production" && appOrigin) {
    const ok = hostMatchesOrigin(hostHeader, appOrigin)
    if (!ok) {
      return { ip: "", source: "host-mismatch" as const }
    }
  }

  let ip = ""
  let source: IpSource = "unknown"

  const cfIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) {
    ip = cfIp
    source = "cf-connecting-ip"
  }

  if (!ip) {
    const forwarded = request.headers.get("x-forwarded-for") ?? ""
    const first = forwarded.split(",")[0]?.trim()
    if (first && (trustProxy || forwarded)) {
      ip = first
      source = "x-forwarded-for"
    }
  }

  if (!ip) {
    const realIp = request.headers.get("x-real-ip")?.trim()
    if (realIp) {
      ip = realIp
      source = "x-real-ip"
    }
  }

  ip = normalizeIp(ip)
  if (ip && !IPV4_REGEX.test(ip) && !isLikelyIpv6(ip)) {
    return { ip: "", source: "invalid" as const }
  }

  return { ip, source }
}

export function requireClientIp(request: Request) {
  const { ip, source } = getClientIp(request)
  if (!ip) {
    throw jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
  }
  return { ip, source }
}
