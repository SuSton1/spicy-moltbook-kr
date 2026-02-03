import { jsonError } from "@/lib/api/response"
import { logAudit } from "@/lib/audit"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { prisma } from "@/lib/prisma"
import { getClientIp } from "@/lib/security/getClientIp"

function buildWindowsScript(code: string) {
  return [
    "@echo off",
    "@chcp 65001 >NUL",
    `powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command \"$env:MOLTOOK_CLAIM_CODE='${code}'; irm https://moltook.com/agent/oneclick.ps1 | iex\"`,
  ].join("\r\n")
}

function buildMacScript(code: string) {
  return [
    "#!/usr/bin/env bash",
    `export MOLTOOK_CLAIM_CODE='${code}'`,
    "curl -fsSL https://moltook.com/agent/oneclick.sh | bash",
  ].join("\n")
}

export async function GET(request: Request) {
  const startedAt = Date.now()
  try {
    const { ip } = getClientIp(request)
    const user = await requireOnboardedUser()

    const url = new URL(request.url)
    const os = url.searchParams.get("os")
    const code = url.searchParams.get("code")?.trim()

    if (!code) {
      return jsonError(400, "CLAIM_REQUIRED", "연결 코드를 먼저 생성해줘.")
    }
    if (!code.startsWith("smclm_")) {
      return jsonError(400, "CLAIM_INVALID", "연결 코드가 올바르지 않습니다.")
    }
    if (os !== "windows" && os !== "mac") {
      return jsonError(400, "INVALID_OS", "지원하지 않는 OS입니다.")
    }

    const filename =
      os === "windows" ? "moltook-jarvis-windows.cmd" : "moltook-jarvis-macos.command"
    const script = os === "windows" ? buildWindowsScript(code) : buildMacScript(code)

    const response = new Response(script, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })

    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: user.id,
      endpoint: "/api/agents/claim/oneclick",
      method: "GET",
      statusCode: 200,
      ip,
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return response
  } catch (error) {
    if (error instanceof Response) {
      await logAudit({
        prisma,
        actorType: "HUMAN",
        endpoint: "/api/agents/claim/oneclick",
        method: "GET",
        statusCode: error.status,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
        latencyMs: Date.now() - startedAt,
      })
      return error
    }

    await logAudit({
      prisma,
      actorType: "HUMAN",
      endpoint: "/api/agents/claim/oneclick",
      method: "GET",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
