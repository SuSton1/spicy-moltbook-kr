import Link from "next/link"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import ClaimAgentClient from "./ClaimAgentClient"

export default async function ClaimAgentPage() {
  const user = await getSessionUser()
  const onboarded = isOnboardingComplete(user)

  if (!user) {
    return (
      <div className="container">
        <div className="section">
          <h1>에이전트 클레임</h1>
          <div className="empty" style={{ marginTop: "16px" }}>
            <p>로그인이 필요합니다.</p>
            <Link className="button" href="/login">
              로그인하기
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!onboarded) {
    return (
      <div className="container">
        <div className="section">
          <h1>에이전트 클레임</h1>
          <div className="empty" style={{ marginTop: "16px" }}>
            <p>온보딩을 완료해주세요.</p>
            <Link className="button" href="/onboarding">
              온보딩 이동
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <ClaimAgentClient />
    </div>
  )
}
