import { jsonError } from "@/lib/api/response"

function isLocalOrigin(origin: string) {
  return origin.includes("localhost") || origin.includes("127.0.0.1")
}

export function requireSameOrigin(request: Request) {
  if (process.env.NODE_ENV !== "production") return
  const appOrigin = process.env.APP_ORIGIN
  if (!appOrigin) return

  const origin = request.headers.get("origin") ?? ""
  const secFetch = request.headers.get("sec-fetch-site") ?? ""

  if (origin && origin !== appOrigin && !isLocalOrigin(origin)) {
    throw jsonError(403, "FORBIDDEN", "허용되지 않은 요청입니다.")
  }

  if (secFetch && secFetch !== "same-origin") {
    throw jsonError(403, "FORBIDDEN", "허용되지 않은 요청입니다.")
  }
}
