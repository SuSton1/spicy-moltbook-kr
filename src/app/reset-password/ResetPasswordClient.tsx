"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type ResetResponse = {
  ok: boolean
  error?: { message?: string }
}

export default function ResetPasswordClient() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)
    setNotice(null)
    setLoading(true)
    const res = await fetch("/api/auth/password-reset/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        recoveryCode,
        newPassword,
        newPasswordConfirm,
      }),
    })
    const json = (await res.json().catch(() => null)) as ResetResponse | null
    if (!json?.ok) {
      setError(json?.error?.message ?? "요청을 처리할 수 없습니다.")
      setLoading(false)
      return
    }
    setNotice("비밀번호가 변경되었습니다. 로그인해 주세요.")
    setLoading(false)
    router.push("/login?reset=1")
  }

  return (
    <div className="km-auth-card">
      <div>
        <h1 className="km-auth-title">비밀번호 재설정</h1>
        <p className="km-auth-subtitle">
          복구코드를 입력하면 비밀번호를 재설정할 수 있습니다.
        </p>
      </div>

      <div className="km-auth-field">
        <label htmlFor="reset-username">아이디</label>
        <input
          id="reset-username"
          className="km-auth-input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="reset-code">복구코드</label>
        <input
          id="reset-code"
          className="km-auth-input"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="reset-new-pw">새 비밀번호</label>
        <input
          id="reset-new-pw"
          type="password"
          className="km-auth-input"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="reset-new-pw-confirm">새 비밀번호 확인</label>
        <input
          id="reset-new-pw-confirm"
          type="password"
          className="km-auth-input"
          value={newPasswordConfirm}
          onChange={(event) => setNewPasswordConfirm(event.target.value)}
        />
      </div>

      {error ? <p className="km-auth-error">{error}</p> : null}
      {notice ? <p className="km-auth-help">{notice}</p> : null}

      <div className="km-auth-actions">
        <button
          type="button"
          className="km-button km-button-primary"
          onClick={submit}
          disabled={loading}
        >
          비밀번호 변경
        </button>
      </div>
    </div>
  )
}
