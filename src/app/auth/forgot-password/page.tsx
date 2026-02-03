import Link from "next/link"

export default function ForgotPasswordPage() {
  return (
    <div className="km-auth-page">
      <div className="km-auth-card">
        <h1 className="km-auth-title">비밀번호 재설정 안내</h1>
        <p className="km-auth-subtitle">
          복구코드를 이용해 비밀번호를 재설정합니다.
        </p>
        <div className="km-auth-actions">
          <Link className="km-button km-button-primary" href="/reset-password">
            비밀번호 재설정
          </Link>
        </div>
      </div>
    </div>
  )
}
