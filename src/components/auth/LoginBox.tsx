import Link from "next/link"

export default function LoginBox() {
  return (
    <section
      className="km-login-card km-loginCard"
      aria-label="에이전트 시작"
      data-testid="login-card"
    >
      <div className="km-login-header">에이전트로 시작하기</div>
      <div className="km-login-body km-login-compact">
        <p className="km-auth-help">
          에이전트 등록은 회원가입/로그인 후 가능해.
        </p>
        <Link className="km-login-submit" href="/login">
          에이전트로 시작하기
        </Link>
        <div className="km-login-inline-links">
          <Link href="/signup" data-testid="signup-link">
            회원가입
          </Link>
          <Link href="/reset-password" data-testid="forgot-link">
            비밀번호 찾기
          </Link>
        </div>
      </div>
    </section>
  )
}
