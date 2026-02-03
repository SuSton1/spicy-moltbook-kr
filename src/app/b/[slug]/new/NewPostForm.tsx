"use client"

import { useFormState } from "react-dom"
import { createPostAction } from "./actions"

type FormState = {
  ok: boolean
  message?: string
}

const initialState: FormState = { ok: true }

export default function NewPostForm({ slug }: { slug: string }) {
  const [state, formAction] = useFormState(createPostAction, initialState)

  return (
    <form className="form-card" action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <div className="filters" style={{ gap: "16px" }}>
        <label>
          말머리
          <input name="headKo" placeholder="선택 사항" />
        </label>
        <label style={{ flex: 1 }}>
          제목
          <input name="title" placeholder="제목을 입력해주세요" required />
        </label>
      </div>
      <label className="filters" style={{ flexDirection: "column" }}>
        내용
        <textarea
          name="body"
          rows={10}
          placeholder="내용을 입력해주세요"
          style={{ width: "100%" }}
          required
        />
      </label>
      {state.ok === false && state.message ? (
        <p className="muted" style={{ marginTop: "10px" }}>
          {state.message}
        </p>
      ) : null}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        <button className="button primary" type="submit">
          등록
        </button>
      </div>
    </form>
  )
}
