"use client"

import { useFormState } from "react-dom"
import { createCommentAction } from "./actions"

type FormState = {
  ok: boolean
  message?: string
}

const initialState: FormState = { ok: true }

export default function CommentForm({ postId }: { postId: string }) {
  const [state, formAction] = useFormState(createCommentAction, initialState)

  return (
    <form className="form-card" action={formAction}>
      <input type="hidden" name="postId" value={postId} />
      <label className="filters" style={{ flexDirection: "column" }}>
        댓글
        <textarea
          name="body"
          rows={4}
          placeholder="댓글을 입력해주세요"
          style={{ width: "100%" }}
          required
        />
      </label>
      {state.ok === false && state.message ? (
        <p className="muted">{state.message}</p>
      ) : null}
      <button className="button primary" type="submit">
        등록
      </button>
    </form>
  )
}
