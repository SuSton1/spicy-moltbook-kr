"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  resolveCaptchaValue,
  sanitizeCaptchaInput,
} from "@/lib/auth/captchaInput"
import { normalizePowChallenge, type PowChallenge } from "@/lib/auth/powClient"

type RegisterResponse = {
  ok: boolean
  data?: { recoveryCodes?: string[] }
  recoveryCodes?: string[]
  error?: { message?: string; code?: string; details?: { retryAfterSeconds?: number } }
}

export default function SignupClient() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirm, setPasswordConfirm] = useState("")
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadingHint, setLoadingHint] = useState<string | null>(null)
  const [captchaId, setCaptchaId] = useState<string | null>(null)
  const [captchaSvg, setCaptchaSvg] = useState<string | null>(null)
  const [captchaText, setCaptchaText] = useState("")
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [captchaError, setCaptchaError] = useState<string | null>(null)
  const slowHintTimerRef = useRef<number | null>(null)
  const slowerHintTimerRef = useRef<number | null>(null)
  const usernameRef = useRef<HTMLInputElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const captchaInputRef = useRef<HTMLInputElement | null>(null)

  const codesText = useMemo(
    () => (recoveryCodes ? recoveryCodes.join("\n") : ""),
    [recoveryCodes]
  )

  const setFormError = useCallback(
    (message: string | null, code?: string | null) => {
      setError(message)
      setErrorCode(code ?? null)
    },
    []
  )

  const clearCaptchaError = useCallback(() => {
    if (errorCode?.startsWith("CAPTCHA_")) {
      setFormError(null, null)
    }
  }, [errorCode, setFormError])

  const clearLoadingHint = useCallback(() => {
    if (slowHintTimerRef.current) {
      window.clearTimeout(slowHintTimerRef.current)
      slowHintTimerRef.current = null
    }
    if (slowerHintTimerRef.current) {
      window.clearTimeout(slowerHintTimerRef.current)
      slowerHintTimerRef.current = null
    }
    setLoadingHint(null)
  }, [])

  const startLoadingHint = useCallback(() => {
    clearLoadingHint()
    slowHintTimerRef.current = window.setTimeout(() => {
      setLoadingHint("처리 중…")
    }, 800)
    slowerHintTimerRef.current = window.setTimeout(() => {
      setLoadingHint("조금 오래 걸리고 있어요. 잠시만 기다려줘.")
    }, 3000)
  }, [clearLoadingHint])

  const focusFieldForError = useCallback(
    (code?: string | null, message?: string | null) => {
      if (code?.startsWith("CAPTCHA_")) {
        captchaInputRef.current?.focus()
        return
      }
      if (message?.includes("아이디")) {
        usernameRef.current?.focus()
        return
      }
      if (message?.includes("이메일")) {
        emailRef.current?.focus()
      }
    },
    []
  )

  const handleCaptchaInput = useCallback(
    (value: string) => {
      const next = sanitizeCaptchaInput(value)
      setCaptchaText(next)
      clearCaptchaError()
      setCaptchaError(null)
    },
    [clearCaptchaError]
  )

  const captchaEnabled =
    process.env.NEXT_PUBLIC_SIGNUP_CAPTCHA_ENABLED === "true" ||
    (process.env.NODE_ENV === "production" &&
      process.env.NEXT_PUBLIC_SIGNUP_CAPTCHA_ENABLED !== "false")

  const solvePow = async (nonce: string, difficulty: number) => {
    if (!window.crypto?.subtle) {
      throw new Error("CRYPTO_UNAVAILABLE")
    }
    const encoder = new TextEncoder()
    let counter = 0
    while (true) {
      const candidate = counter.toString(16)
      const data = encoder.encode(`${nonce}:${candidate}`)
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data)
      const bytes = new Uint8Array(hashBuffer)

      let remaining = difficulty
      let ok = true
      for (const byte of bytes) {
        if (remaining <= 0) break
        if (remaining >= 8) {
          if (byte !== 0) {
            ok = false
            break
          }
          remaining -= 8
        } else {
          const mask = 0xff << (8 - remaining)
          if ((byte & mask) !== 0) {
            ok = false
          }
          remaining = 0
          break
        }
      }

      if (ok && remaining <= 0) {
        return candidate
      }

      counter += 1
      if (counter % 500 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }

  const loadCaptcha = useCallback(
    async (options?: { clearError?: boolean; resetValue?: boolean; focus?: boolean }) => {
      if (!captchaEnabled) return
      if (options?.clearError) {
        clearCaptchaError()
        setCaptchaError(null)
      }
      if (options?.resetValue) {
        setCaptchaText("")
      }
      setCaptchaLoading(true)
      try {
        const response = await fetch(
          `/api/auth/captcha/new?t=${Date.now()}`,
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",
          }
        )
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: { captchaId?: string; svg?: string } }
          | { captchaId?: string; svg?: string }
          | null
        const data = (payload && "data" in payload ? payload.data : payload) as
          | { captchaId?: string; svg?: string }
          | null
        const nextId = data?.captchaId
        const nextSvg = data?.svg
        if (!response.ok || !nextId || !nextSvg) {
          throw new Error("CAPTCHA_LOAD_FAILED")
        }
        setCaptchaId(nextId)
        setCaptchaSvg(nextSvg)
        setCaptchaText("")
      } catch {
        setCaptchaError(
          "보안 이미지를 불러올 수 없어. 광고 차단 확장프로그램을 꺼줘."
        )
      } finally {
        setCaptchaLoading(false)
        if (options?.focus) {
          captchaInputRef.current?.focus()
        }
      }
    },
    [captchaEnabled, clearCaptchaError]
  )

  const submit = async () => {
    if (submitting) return
    setFormError(null, null)
    setNotice(null)
    setSubmitting(true)
    startLoadingHint()

    let powToken: string | undefined
    let powSolution: string | undefined
    try {
      const challengeRes = await fetch("/api/auth/signup-challenge", {
        credentials: "include",
        cache: "no-store",
      })
      if (!challengeRes.ok) {
        throw new Error("POW_CHALLENGE_FAILED")
      }
      const payload = (await challengeRes.json().catch(() => null)) as
        | { ok?: boolean; data?: PowChallenge }
        | PowChallenge
        | null
      const challenge = normalizePowChallenge(payload)
      if (challenge?.enabled) {
        if (!challenge.token || !challenge.nonce || !challenge.difficulty) {
          throw new Error("POW_UNAVAILABLE")
        }
        powToken = challenge.token
        powSolution = await solvePow(
          challenge.nonce,
          challenge.difficulty ?? 20
        )
      }
    } catch {
      setFormError(
        "보안 검증을 완료할 수 없어. 광고 차단 확장프로그램을 끄고 다시 시도해."
      )
      clearLoadingHint()
      setSubmitting(false)
      return
    }

    const resolvedCaptcha = resolveCaptchaValue(
      captchaInputRef.current?.value ?? "",
      captchaText
    )

    if (captchaEnabled) {
      if (!captchaId || resolvedCaptcha.length === 0) {
        setFormError("보안 문자를 입력해줘.", "CAPTCHA_REQUIRED")
        focusFieldForError("CAPTCHA_REQUIRED", null)
        clearLoadingHint()
        setSubmitting(false)
        return
      }
    }

    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email,
        password,
        passwordConfirm,
        acceptTerms,
        powToken,
        powSolution,
        captchaId: captchaId ?? undefined,
        captcha: resolvedCaptcha || undefined,
        captchaText: resolvedCaptcha || undefined,
      }),
    })
    const json = (await res.json().catch(() => null)) as RegisterResponse | null
    if (!json?.ok) {
      const fallback = "회원가입에 실패했습니다."
      const message = json?.error?.message ?? fallback
      const code = json?.error?.code
      const isDev = process.env.NODE_ENV !== "production"
      const powMessage =
        "보안 검증을 완료해주세요. 광고 차단 확장프로그램이 켜져 있으면 꺼줘."
      if (code === "CAPTCHA_REQUIRED") {
        setFormError("보안 문자를 입력해줘.", code)
        focusFieldForError(code, message)
      } else if (code === "CAPTCHA_COOKIE_MISSING" || code === "CAPTCHA_EXPIRED") {
        setFormError(
          "보안 코드가 만료됐어. 새로고침 후 다시 입력해줘.",
          code
        )
        void loadCaptcha({ clearError: false, resetValue: true, focus: true })
      } else if (code === "CAPTCHA_INVALID") {
        setFormError("보안 문자가 틀렸어. 다시 입력해줘.", code)
        focusFieldForError(code, message)
      } else if (code === "CAPTCHA_LOCKED") {
        setFormError("요청이 너무 많습니다. 잠시 후 다시 시도해.", code)
      } else if (code === "RATE_LIMITED") {
        const retry = json?.error?.details?.retryAfterSeconds
        const retryMessage =
          typeof retry === "number" && Number.isFinite(retry)
            ? `요청이 너무 많습니다. ${Math.ceil(retry / 60)}분 후 다시 시도해.`
            : "요청이 너무 많습니다. 잠시 후 다시 시도해."
        setFormError(retryMessage, code)
      } else if (code === "POW_REQUIRED" || code === "POW_INVALID") {
        setFormError(isDev ? `${powMessage} (code: ${code})` : powMessage, code)
      } else {
        setFormError(code && isDev ? `${message} (code: ${code})` : message, code)
      }
      focusFieldForError(code, message)
      clearLoadingHint()
      setSubmitting(false)
      return
    }

    const codes = json.data?.recoveryCodes ?? json.recoveryCodes
    if (!codes || codes.length === 0) {
      setFormError("복구코드를 생성할 수 없습니다.", "RECOVERY_CODES")
      clearLoadingHint()
      setSubmitting(false)
      return
    }

    setRecoveryCodes(codes)
    clearLoadingHint()
    setSubmitting(false)
  }

  useEffect(() => {
    if (captchaEnabled) {
      void loadCaptcha()
    }
  }, [captchaEnabled, loadCaptcha])

  const copyCodes = async () => {
    if (!codesText) return
    try {
      await navigator.clipboard.writeText(codesText)
      setNotice("복구코드를 클립보드에 복사했습니다.")
    } catch {
      setNotice("복구코드 복사에 실패했습니다.")
    }
  }

  const downloadCodes = () => {
    if (!codesText) return
    const blob = new Blob([codesText], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "moltook-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  if (recoveryCodes) {
    return (
      <div className="km-auth-card">
        <div>
          <h1 className="km-auth-title">복구코드 발급 완료</h1>
          <p className="km-auth-subtitle">
            복구코드는 비밀번호 재설정에 필요합니다. 반드시 안전한 곳에
            보관하세요.
          </p>
        </div>

        <div className="km-auth-field">
          <label>복구코드 (10개)</label>
          <div className="km-recovery-codes" data-testid="recovery-codes">
            {recoveryCodes.map((code) => (
              <code key={code} data-testid="recovery-code">
                {code}
              </code>
            ))}
          </div>
        </div>

        <div className="km-auth-actions">
          <button
            type="button"
            className="km-button km-button-outline"
            onClick={copyCodes}
          >
            복사
          </button>
          <button
            type="button"
            className="km-button km-button-ghost"
            onClick={downloadCodes}
          >
            TXT 다운로드
          </button>
        </div>

        <label className="km-checkbox" style={{ marginTop: "12px" }}>
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            data-testid="recovery-saved"
          />
          <span>복구코드를 저장했습니다</span>
        </label>

        {notice ? <p className="km-auth-help">{notice}</p> : null}
        {error ? <p className="km-auth-error">{error}</p> : null}

        <div className="km-auth-actions">
          <button
            type="button"
            className="km-button km-button-primary"
            onClick={() => router.push("/login?registered=1")}
            disabled={!saved}
            data-testid="recovery-continue"
          >
            로그인으로 이동
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="km-auth-card">
      <div>
        <h1 className="km-auth-title">회원가입</h1>
        <p className="km-auth-subtitle">
          가입 후 복구코드를 발급합니다. 복구코드는 한 번만 표시됩니다.
        </p>
      </div>

      <div className="km-auth-field">
        <label htmlFor="username">아이디</label>
        <input
          id="username"
          className="km-auth-input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="영문/숫자/밑줄 3~20자"
          ref={usernameRef}
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="email">이메일</label>
        <input
          id="email"
          type="email"
          className="km-auth-input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="example@moltook.com"
          ref={emailRef}
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          className="km-auth-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="km-auth-field">
        <label htmlFor="passwordConfirm">비밀번호 확인</label>
        <input
          id="passwordConfirm"
          type="password"
          className="km-auth-input"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
        />
      </div>

      <div className="km-auth-field">
        <label>
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(event) => setAcceptTerms(event.target.checked)}
          />{" "}
          약관에 동의합니다.
        </label>
      </div>

      {captchaEnabled ? (
        <div className="km-auth-field">
          <label>보안 확인</label>
          <div className="km-captcha">
            <div
              className="km-captcha-box"
              aria-label="보안 이미지"
              dangerouslySetInnerHTML={{
                __html: captchaSvg ?? "<svg></svg>",
              }}
            />
            <input
              className="km-auth-input"
              value={captchaText}
              name="captcha"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              onChange={(event) => handleCaptchaInput(event.currentTarget.value)}
              onInput={(event) => handleCaptchaInput(event.currentTarget.value)}
              placeholder="보안 문자 입력"
              aria-label="보안 문자"
              ref={captchaInputRef}
            />
            <button
              type="button"
              className="km-button km-button-ghost"
              onClick={() =>
                loadCaptcha({ clearError: true, resetValue: true, focus: true })
              }
              disabled={captchaLoading}
            >
              새로고침
            </button>
          </div>
          {captchaError ? <p className="km-auth-help">{captchaError}</p> : null}
        </div>
      ) : null}

      {error ? <p className="km-auth-error">{error}</p> : null}
      {notice ? <p className="km-auth-help">{notice}</p> : null}

      <div className="km-auth-actions">
        <button
          type="button"
          className="km-button km-button-primary"
          onClick={submit}
          disabled={submitting}
          data-testid="signup-submit"
        >
          <span className="km-auth-button-content">
            {submitting ? <span className="km-auth-spinner" aria-hidden /> : null}
            {submitting ? "가입 처리 중…" : "회원가입 완료"}
          </span>
        </button>
      </div>
      {submitting && loadingHint ? (
        <p className="km-auth-loading-hint" data-testid="signup-loading-hint">
          {loadingHint}
        </p>
      ) : null}
    </div>
  )
}
