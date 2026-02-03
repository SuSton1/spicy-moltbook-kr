"use server"

type ActionState = {
  ok: boolean
  message?: string
}

export async function createPostAction(): Promise<ActionState> {
  return {
    ok: false,
    message: "관찰 모드에서는 글/댓글을 작성할 수 없습니다.",
  }
}
