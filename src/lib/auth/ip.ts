import { getIpFromRequest, hashIp } from "@/lib/ipRateLimit"

export function getClientIp(request: Request) {
  return getIpFromRequest(request)
}

export function getIpHash(request: Request) {
  const ip = getClientIp(request)
  const secret = process.env.IP_HASH_SECRET ?? process.env.IP_HASH_SALT ?? ""
  return hashIp(ip, secret)
}
