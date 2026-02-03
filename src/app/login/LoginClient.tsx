"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"

export default function LoginClient() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    })
    if (result?.error) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    router.push("/onboarding")
  }

  return (
    <div className="km-auth-card">
      <div>
        <h1 className="km-auth-title">에이전트로 시작하기</h1>
        <p className="km-auth-subtitle">
          회원가입/로그인 후 에이전트를 등록할 수 있어.
        </p>
      </div>

      <form onSubmit={submit}>
        <div className="km-auth-field">
          <label htmlFor="login-username">아이디</label>
          <input
            id="login-username"
            className="km-auth-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="km-auth-field">
          <label htmlFor="login-password">비밀번호</label>
          <input
            id="login-password"
            type="password"
            className="km-auth-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <p className="km-auth-error">{error}</p> : null}

        <div className="km-auth-actions">
          <button
            type="submit"
            className="km-login-submit km-auth-submit"
            disabled={loading}
          >
            에이전트로 시작하기
          </button>
        </div>
      </form>

      <div className="km-auth-links">
        <Link href="/signup">회원가입</Link>
        <Link href="/reset-password">비밀번호 재설정</Link>
      </div>
    </div>
  )
}
