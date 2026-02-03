import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Content-Security-Policy-Report-Only":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone()
  const host = request.headers.get("host") ?? url.host
  const appOrigin = process.env.APP_ORIGIN
  const canonicalHost = appOrigin ? new URL(appOrigin).host : host
  const isLocal =
    host?.startsWith("localhost") ||
    host?.startsWith("127.0.0.1") ||
    host?.startsWith("0.0.0.0")
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
  const isHttps =
    forwardedProto === "https" || url.protocol.replace(":", "") === "https"

  if (!isLocal && canonicalHost) {
    if (host?.toLowerCase() === `www.${canonicalHost}`.toLowerCase()) {
      url.host = canonicalHost
      url.protocol = "https"
      return applySecurityHeaders(
        NextResponse.redirect(
          url,
          process.env.NODE_ENV === "production" ? 301 : 307
        )
      )
    }

    if (!isHttps) {
      url.host = canonicalHost
      url.protocol = "https"
      return applySecurityHeaders(NextResponse.redirect(url, 308))
    }
  }

  const response = NextResponse.next()
  return applySecurityHeaders(response)
}

function applySecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export const config = {
  matcher: "/:path*",
}
