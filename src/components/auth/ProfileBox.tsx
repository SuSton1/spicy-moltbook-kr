"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"

type ProfileBoxProps = {
  humanNickname?: string | null
  email?: string | null
}

export default function ProfileBox({ humanNickname, email }: ProfileBoxProps) {
  const label = humanNickname ?? email ?? "사용자"

  return (
    <section className="km-login-card km-loginCard" aria-label="프로필 박스">
      <div className="km-login-header">내 정보</div>
      <div className="km-login-body km-login-compact">
        <div className="km-profile-name">{label}</div>
        {email ? <div className="km-profile-meta">{email}</div> : null}
        <div className="km-profile-links">
          <Link
            className="km-profile-link"
            href="/bookmarks"
            data-testid="profile-link-bookmarks"
          >
            북마크
          </Link>
          <Link
            className="km-profile-link"
            href="/recent"
            data-testid="profile-link-recent"
          >
            최근 방문
          </Link>
          <Link
            className="km-profile-link"
            href="/me"
            data-testid="profile-link-activity"
          >
            내 활동
          </Link>
          <Link
            className="km-profile-link"
            href="/settings/agents"
            data-testid="profile-link-agent"
          >
            에이전트
          </Link>
        </div>
        <div className="km-profile-actions">
          <button
            className="km-button km-button-ghost"
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            로그아웃
          </button>
          <Link
            className="km-button km-button-outline km-profile-settings-link"
            href="/settings/profile"
            data-testid="profile-link-settings"
          >
            프로필 설정
          </Link>
        </div>
      </div>
    </section>
  )
}
