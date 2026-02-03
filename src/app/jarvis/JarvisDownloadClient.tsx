"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

type Props = {
  isLoggedIn: boolean
  agentNickname: string | null
}

type ClaimResponse = {
  claimCode: string
  expiresAt: string
}

export default function JarvisDownloadClient({
  isLoggedIn,
  agentNickname,
}: Props) {
  const [loading, setLoading] = useState<null | "windows" | "mac">(null)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const autoStartedRef = useRef(false)
  const windowsDirect = process.env.NEXT_PUBLIC_JARVIS_WINDOWS_URL
  const macDirect = process.env.NEXT_PUBLIC_JARVIS_MAC_URL

  const startDownload = useCallback(async (os: "windows" | "mac") => {
    setError(null)
    setLoading(os)
    try {
      if (os === "windows" && windowsDirect) {
        window.location.href = windowsDirect
        return
      }
      if (os === "mac" && macDirect) {
        window.location.href = macDirect
        return
      }

      const directRes = await fetch(`/api/jarvis/download?os=${os}`)
      if (directRes.ok) {
        const payload = (await directRes.json()) as {
          ok: boolean
          data?: { url?: string }
        }
        const directUrl = payload?.data?.url
        if (directUrl) {
          window.location.href = directUrl
          return
        }
      }

      const res = await fetch("/api/agents/claim/start", { method: "POST" })
      const data = (await res.json()) as {
        ok: boolean
        data?: ClaimResponse
        error?: { message?: string }
      }
      if (!res.ok || !data?.data?.claimCode) {
        setError(data?.error?.message ?? "코드를 만들 수 없습니다.")
        return
      }
      const code = data.data.claimCode
      window.location.href = `/api/agents/claim/oneclick?os=${os}&code=${encodeURIComponent(
        code
      )}`
    } catch {
      setError("다운로드를 시작할 수 없습니다.")
    } finally {
      setLoading(null)
    }
  }, [macDirect, windowsDirect])

  useEffect(() => {
    if (autoStartedRef.current) return
    const auto = searchParams.get("autodownload")
    const os = searchParams.get("os")
    if (
      auto === "1" &&
      (os === "windows" || os === "mac") &&
      (Boolean(windowsDirect || macDirect) || (isLoggedIn && agentNickname))
    ) {
      autoStartedRef.current = true
      startDownload(os)
    }
  }, [
    agentNickname,
    isLoggedIn,
    macDirect,
    searchParams,
    startDownload,
    windowsDirect,
  ])

  return (
    <section className="km-card" style={{ marginTop: 16 }}>
      <div className="km-card-header">
        <div>
          <div className="km-card-title">내 PC에 연결하기</div>
          <div className="km-card-desc">
            Windows / macOS에서 한 번 실행하면 바로 연결돼.
          </div>
        </div>
      </div>

      {!isLoggedIn ? (
        <div className="km-card-list">
          <p>로그인 후 다운로드할 수 있어.</p>
          <Link className="km-button km-button-primary" href="/login?returnTo=/jarvis">
            로그인하기
          </Link>
        </div>
      ) : !agentNickname ? (
        <div className="km-card-list">
          <p>에이전트 닉네임을 먼저 설정해줘.</p>
          <Link className="km-button km-button-primary" href="/settings/agents">
            닉네임 설정하러 가기
          </Link>
        </div>
      ) : (
        <div className="km-card-list">
          <div className="km-card-grid">
            <button
              className="km-button km-button-primary"
              type="button"
              onClick={() => startDownload("windows")}
              disabled={loading !== null}
            >
              {loading === "windows" ? "준비 중..." : "Windows 다운로드"}
            </button>
            <button
              className="km-button km-button-primary"
              type="button"
              onClick={() => startDownload("mac")}
              disabled={loading !== null}
            >
              {loading === "mac" ? "준비 중..." : "macOS 다운로드"}
            </button>
          </div>
          <p className="km-card-desc">
            실행 후 화면 안내에 따라 API 키를 입력하면 연결돼.
          </p>
        </div>
      )}

      {error ? <p className="km-card-desc" style={{ color: "var(--km-danger)" }}>{error}</p> : null}
    </section>
  )
}
