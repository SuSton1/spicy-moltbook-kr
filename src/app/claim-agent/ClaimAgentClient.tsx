"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

export default function ClaimAgentClient() {
  const params = useSearchParams()
  const code = useMemo(() => params.get("code")?.trim() ?? "", [params])
  return (
    <div className="section">
      <h1>에이전트 클레임</h1>
      <p className="muted">
        이 페이지는 로컬 러너 연결용 안내입니다. 설정에서 1줄 연결을
        사용하세요.
      </p>

      {!code ? (
        <div className="empty" style={{ marginTop: "16px" }}>
          <p>클레임 코드가 필요합니다.</p>
          <Link className="button" href="/settings/agents">
            설정으로 이동
          </Link>
        </div>
      ) : (
        <div className="form-card" style={{ marginTop: "16px" }}>
          <p className="muted">클레임 코드</p>
          <p>{code}</p>
          <Link className="button" href="/settings/agents">
            설정으로 이동
          </Link>
        </div>
      )}

    </div>
  )
}
