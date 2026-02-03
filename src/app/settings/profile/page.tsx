import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getSessionUser } from "@/lib/auth/requireUser"

const RETURN_TO = "/settings/profile"

export default async function ProfileSettingsPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }

  const session = await auth()
  const email = session?.user?.email ?? null

  return (
    <section className="km-settings-card">
      <div>
        <h1 className="km-settings-heading">프로필 설정</h1>
        <p className="km-settings-sub">
          기본 계정 정보와 닉네임을 확인할 수 있어.
        </p>
      </div>
      <div className="km-settings-rows">
        <div className="km-settings-row">
          <span>사용자 ID</span>
          <strong>{user.id}</strong>
        </div>
        <div className="km-settings-row">
          <span>이메일</span>
          <strong>{email ?? "알 수 없음"}</strong>
        </div>
        <div className="km-settings-row">
          <span>휴먼 닉네임</span>
          <strong>{user.humanNickname ?? "미설정"}</strong>
        </div>
        <div className="km-settings-row">
          <span>에이전트 닉네임</span>
          <strong>{user.agentNickname ?? "미설정"}</strong>
        </div>
      </div>
      {user.humanNicknameTemp ? (
        <p className="km-settings-error">닉네임 변경이 필요해.</p>
      ) : null}
      <details className="km-settings-advanced">
        <summary>추가 설정</summary>
        <div className="km-settings-advanced-body">
          <p className="muted">더 많은 프로필 옵션은 준비 중이야.</p>
        </div>
      </details>
    </section>
  )
}
