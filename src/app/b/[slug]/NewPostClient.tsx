"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type NewPostClientProps = {
  board: { slug: string; titleKo: string }
  isLoggedIn: boolean
  canPost: boolean
}

export default function NewPostClient({
  board,
  isLoggedIn,
  canPost,
}: NewPostClientProps) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [guestNickname, setGuestNickname] = useState("")
  const [guestPassword, setGuestPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const showForm = !isLoggedIn || canPost

  const submitPost = async () => {
    if (isLoggedIn && !canPost) {
      setError("온보딩을 완료해주세요.")
      return
    }
    if (!title.trim() || !body.trim()) {
      setError("제목과 내용을 입력해주세요.")
      return
    }
    if (!isLoggedIn) {
      const trimmedNickname = guestNickname.trim()
      if (!trimmedNickname) {
        setError("닉네임을 입력해줘.")
        return
      }
      if (trimmedNickname.length < 2) {
        setError("닉네임은 2자 이상이야.")
        return
      }
      if (!guestPassword) {
        setError("비밀번호를 입력해줘.")
        return
      }
      if (guestPassword.length < 4) {
        setError("비밀번호는 4자 이상이야.")
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/boards/${board.slug}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          ...(isLoggedIn
            ? {}
            : { guestNickname: guestNickname.trim(), guestPassword }),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const code = payload?.error?.code as string | undefined
        if (code === "PASSWORD_REQUIRED") {
          setError("비밀번호를 입력해줘.")
        } else if (code === "PASSWORD_INVALID") {
          setError("비밀번호가 틀렸어.")
        } else if (code === "RATE_LIMITED") {
          setError("너무 많이 시도했어. 잠시 후 다시 해줘.")
        } else {
          setError(payload?.error?.message ?? "글을 등록할 수 없습니다.")
        }
        return
      }
      const postId = payload?.data?.id
      if (postId) {
        router.push(`/p/${postId}`)
        router.refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="km-post-new">
      <h2 className="km-post-new-title">{board.titleKo} 글쓰기</h2>
      <p className="km-post-new-sub">
        {isLoggedIn
          ? canPost
            ? "글을 작성해봐."
            : "온보딩을 완료하면 글을 쓸 수 있어."
          : "닉네임과 비밀번호로 글을 작성할 수 있어."}
      </p>

      {showForm ? (
        <form
          className="km-post-form"
          onSubmit={(event) => {
            event.preventDefault()
            submitPost()
          }}
        >
          {!isLoggedIn ? (
            <div className="km-guest-fields">
              <label className="km-post-field">
                <span>닉네임</span>
                  <input
                    value={guestNickname}
                    onChange={(event) => setGuestNickname(event.target.value)}
                    placeholder="닉네임"
                    required
                  />
                </label>
                <label className="km-post-field">
                  <span>비밀번호</span>
                  <input
                    type="password"
                    value={guestPassword}
                    onChange={(event) => setGuestPassword(event.target.value)}
                    placeholder="비밀번호(수정/삭제용)"
                    required
                  />
                  <p className="km-guest-helper">
                    비밀번호는 수정/삭제에 필요해. 잊으면 복구 불가.
                  </p>
                </label>
              </div>
            ) : null}
          <label className="km-post-field">
            <span>제목</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="제목을 입력해줘"
              required
            />
          </label>
          <label className="km-post-field">
            <span>내용</span>
            <textarea
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="내용을 입력해줘"
              required
            />
          </label>
          {error ? <p className="km-post-error">{error}</p> : null}
          <button
            className="km-post-action km-post-action-primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "처리 중…" : "글쓰기"}
          </button>
        </form>
      ) : (
        <div className="km-post-login">
          <p>온보딩을 완료하면 글을 쓸 수 있어.</p>
          <a className="km-post-action" href="/onboarding">
            온보딩하기
          </a>
        </div>
      )}
    </div>
  )
}
