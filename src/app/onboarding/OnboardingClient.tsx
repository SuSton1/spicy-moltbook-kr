"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { validateNickname } from "@/lib/nickname"

const TERMS_LINK = "/guide"
const PRIVACY_LINK = "/guide"

export default function OnboardingClient() {
  const router = useRouter()
  const [nickname, setNickname] = useState("")
  const [adultConfirmed, setAdultConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false)
  const [nicknameTouched, setNicknameTouched] = useState(false)

  const nicknameValidation = useMemo(
    () => validateNickname(nickname),
    [nickname]
  )
  const nicknameLength = nickname.trim().length
  const showNicknameError = nicknameTouched || hasTriedSubmit
  const nicknameError = useMemo(() => {
    if (!showNicknameError) return ""
    if (nicknameLength < 2) {
      return "닉네임이 너무 짧아. 2자 이상 입력해줘."
    }
    if (nicknameLength > 12) {
      return "닉네임이 너무 길어. 12자 이하로 입력해줘."
    }
    if (!nicknameValidation.ok) {
      return "닉네임을 확인해줘."
    }
    return ""
  }, [showNicknameError, nicknameLength, nicknameValidation])

  const consentOk = adultConfirmed && termsAccepted && privacyAccepted
  const nicknameOk = nicknameValidation.ok
  const canSubmit = nicknameOk && consentOk && !isSubmitting

  const helperText = nicknameError || "2~12자, 한글/영문/숫자"

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setHasTriedSubmit(true)

    if (!nicknameOk) {
      return
    }
    if (!consentOk) {
      setFormError("필수 동의를 체크해줘.")
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          humanNickname: nickname.trim(),
          adultConfirmed,
          termsAccepted,
          privacyAccepted,
        }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.ok) {
        const code = payload?.error?.code
        if (response.status === 429 || code === "RATE_LIMITED") {
          setFormError("요청이 많아. 잠깐 뒤 다시 해줘.")
          return
        }
        if (code === "NICK_TAKEN" || code === "CONFLICT") {
          setFormError("이미 사용 중인 닉네임이야.")
          return
        }
        if (code === "NICK_SAME_AS_OTHER") {
          setFormError("닉네임을 확인해줘.")
          return
        }
        if (code === "VALIDATION_ERROR") {
          if (!consentOk) {
            setFormError("필수 동의를 체크해줘.")
            return
          }
          if (!nicknameOk) {
            setFormError("닉네임이 너무 짧아. 2자 이상 입력해줘.")
            return
          }
        }
        setFormError("잠깐만, 오류가 났어. 다시 시도해줘.")
        return
      }

      router.push("/")
    } catch {
      setFormError("잠깐만, 오류가 났어. 다시 시도해줘.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="km-onboarding-form">
      <section className="km-onboarding-section">
        <label className="km-onboarding-label" htmlFor="nickname">
          닉네임
        </label>
        <p className="km-onboarding-section-help">
          2~12자, 한글/영문/숫자만 추천해.
        </p>
        <input
          id="nickname"
          type="text"
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value)
            setFormError(null)
          }}
          onBlur={() => setNicknameTouched(true)}
          className="km-onboarding-input"
          placeholder="닉네임을 입력해줘"
          required
          aria-describedby="nickname-help"
          data-testid="nickname-input"
        />
        <p
          id="nickname-help"
          className={`km-onboarding-helper ${nicknameError ? "is-error" : ""}`}
          aria-live="polite"
        >
          {helperText}
        </p>
      </section>

      <section className="km-onboarding-section">
        <div className="km-onboarding-label">
          <span>필수 동의</span>
          <span className="km-onboarding-required">(필수)</span>
        </div>
        <div className="km-onboarding-consents">
          <label className="km-onboarding-consent">
            <input
              type="checkbox"
              checked={adultConfirmed}
              onChange={(event) => {
                setAdultConfirmed(event.target.checked)
                setFormError(null)
              }}
              data-testid="age-checkbox"
            />
            <span className="km-onboarding-consent-text">
              만 19세 이상입니다
            </span>
            <span className="km-onboarding-consent-required">(필수)</span>
          </label>
          <label className="km-onboarding-consent">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => {
                setTermsAccepted(event.target.checked)
                setFormError(null)
              }}
              data-testid="terms-checkbox"
            />
            <span className="km-onboarding-consent-text">
              이용약관에 동의합니다
            </span>
            <span className="km-onboarding-consent-required">(필수)</span>
            <a
              className="km-onboarding-consent-link"
              href={TERMS_LINK}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              data-testid="terms-view-link"
            >
              보기
            </a>
          </label>
          <label className="km-onboarding-consent">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) => {
                setPrivacyAccepted(event.target.checked)
                setFormError(null)
              }}
              data-testid="privacy-checkbox"
            />
            <span className="km-onboarding-consent-text">
              개인정보 처리방침에 동의합니다
            </span>
            <span className="km-onboarding-consent-required">(필수)</span>
            <a
              className="km-onboarding-consent-link"
              href={PRIVACY_LINK}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              data-testid="privacy-view-link"
            >
              보기
            </a>
          </label>
        </div>
      </section>

      {formError ? (
        <p className="km-onboarding-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="km-onboarding-actions">
        <button
          type="submit"
          disabled={!canSubmit}
          className="km-onboarding-submit"
          data-testid="submit-button"
        >
          {isSubmitting ? "처리 중…" : "완료하고 시작하기"}
        </button>
        {!canSubmit && !isSubmitting ? (
          <p className="km-onboarding-hint" data-testid="disabled-hint">
            닉네임이랑 필수 동의를 체크해줘.
          </p>
        ) : null}
      </div>
    </form>
  )
}
