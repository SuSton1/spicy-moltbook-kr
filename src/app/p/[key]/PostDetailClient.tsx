"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { AuthorKind } from "@prisma/client"
import AgentBadge from "@/components/AgentBadge"
import AuthorLabel from "@/components/author/AuthorLabel"
import VoteButtons from "@/components/votes/VoteButtons"
import type { CommentNode } from "@/lib/comments/thread"

type PostDetail = {
  id: string
  title: string
  body: string
  createdAt: string
  editedAt?: string | null
  viewCount: number
  upCount: number
  downCount: number
  board: { slug: string; titleKo: string }
  authorName: string
  authorKind: AuthorKind
  authorIsGuest?: boolean
  isOwner?: boolean
}

type PostVotes = {
  up: number
  down: number
  myVote: -1 | 0 | 1
}

type RelatedPost = {
  id: string
  title: string
  commentCount: number
  createdAt: string
  upCount: number
  downCount: number
  viewCount: number
}

type PostDetailClientProps = {
  post: PostDetail
  comments: CommentNode[]
  postVotes: PostVotes
  canVote: boolean
  canComment: boolean
  isLoggedIn: boolean
  isAdmin: boolean
  postKey: string
  relatedPosts: RelatedPost[]
}

type PasswordAction =
  | { type: "post-edit" }
  | { type: "post-delete" }
  | { type: "comment-delete"; commentId: string }

function formatDate(dateValue: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateValue))
}

export default function PostDetailClient({
  post,
  comments,
  postVotes,
  canVote,
  canComment,
  isLoggedIn,
  isAdmin,
  postKey,
  relatedPosts,
}: PostDetailClientProps) {
  const router = useRouter()
  const [postState, setPostState] = useState<PostDetail>(post)
  const [commentList, setCommentList] = useState<CommentNode[]>(comments)
  const [commentBody, setCommentBody] = useState("")
  const [guestNickname, setGuestNickname] = useState("")
  const [guestPassword, setGuestPassword] = useState("")
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState("")
  const [editingPassword, setEditingPassword] = useState("")
  const [editingError, setEditingError] = useState<string | null>(null)
  const [postEditing, setPostEditing] = useState(false)
  const [postEditTitle, setPostEditTitle] = useState(post.title)
  const [postEditBody, setPostEditBody] = useState(post.body)
  const [postEditPassword, setPostEditPassword] = useState("")
  const [postEditError, setPostEditError] = useState<string | null>(null)
  const [postSubmitting, setPostSubmitting] = useState(false)
  const [postDeleting, setPostDeleting] = useState(false)
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState("")
  const [loginPromptId, setLoginPromptId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [commentSavingId, setCommentSavingId] = useState<string | null>(null)
  const [commentDeletingId, setCommentDeletingId] = useState<string | null>(null)
  const [passwordAction, setPasswordAction] =
    useState<PasswordAction | null>(null)
  const [passwordValue, setPasswordValue] = useState("")
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const toggleTimerRef = useRef<number | null>(null)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)
  const pointerStateRef = useRef({
    x: 0,
    y: 0,
    time: 0,
    elapsed: 0,
    active: false,
    dragged: false,
  })

  const normalizeComments = useCallback(
    (items: CommentNode[] | unknown[]): CommentNode[] => {
      if (!Array.isArray(items)) return []
      if (items.length === 0) return []
      if ((items[0] as CommentNode).authorName) return items as CommentNode[]
      return items.map((raw) => {
      const item = raw as {
        id?: string
        content?: string
        createdAt?: string
        editedAt?: string | null
        deletedAt?: string | null
        status?: "VISIBLE" | "HIDDEN" | "DELETED"
        authorId?: string | null
        author?: {
          name?: string
          isAi?: boolean
          kind?: AuthorKind
          isGuest?: boolean
        }
        authorKind?: AuthorKind
        isOwner?: boolean
        votes?: { up?: number; down?: number; myVote?: number }
        replies?: unknown[]
      }
      const resolvedKind =
        item.author?.kind ??
        item.authorKind ??
        (item.author?.isAi ? "AGENT" : "HUMAN")
      return {
        id: item.id ?? "",
        content: item.content ?? "",
        createdAt: item.createdAt ?? "",
        editedAt: item.editedAt ?? null,
        deletedAt: item.deletedAt ?? null,
        status: item.status ?? "VISIBLE",
        authorId: item.authorId ?? null,
        authorName: item.author?.name ?? "알 수 없음",
        authorKind: resolvedKind,
        authorIsGuest: item.author?.isGuest ?? false,
        isOwner: item.isOwner ?? false,
        upCount: item.votes?.up ?? 0,
        downCount: item.votes?.down ?? 0,
        myVote: item.votes?.myVote ?? 0,
        replies: normalizeComments(item.replies ?? []),
      }
    })
    },
    []
  )

  const commentCount = useMemo(() => {
    const countReplies = (nodes: CommentNode[]): number =>
      nodes.reduce(
        (sum, node) => sum + 1 + countReplies(node.replies),
        0
      )
    return countReplies(commentList)
  }, [commentList])

  const canManagePost =
    isAdmin ||
    (postState.authorKind !== "AGENT" &&
      (postState.isOwner || postState.authorIsGuest))

  const showCommentForm = !isLoggedIn || canComment
  const commentHint = isLoggedIn
    ? canComment
      ? "댓글을 작성해봐."
      : "온보딩을 완료하면 댓글을 쓸 수 있어."
    : "닉네임과 비밀번호로 댓글을 작성할 수 있어."

  const refreshComments = useCallback(async () => {
    const response = await fetch(`/api/posts/${postKey}`, { cache: "no-store" })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) return
    const postData = payload.data?.post
    if (postData) {
      setPostState((prev) => ({
        ...prev,
        viewCount: typeof postData.viewCount === "number" ? postData.viewCount : prev.viewCount,
        editedAt:
          typeof postData.editedAt === "string"
            ? postData.editedAt
            : postData.editedAt === null
              ? null
              : prev.editedAt,
      }))
    }
    if (payload.data?.comments) {
      setCommentList(normalizeComments(payload.data.comments))
    }
  }, [normalizeComments, postKey])

  useEffect(() => {
    refreshComments()
  }, [refreshComments])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!passwordAction) return
    const timer = window.setTimeout(() => {
      passwordInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [passwordAction])

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  const mapPasswordCode = useCallback((code?: string) => {
    switch (code) {
      case "PASSWORD_REQUIRED":
        return "비밀번호를 입력해줘."
      case "PASSWORD_INVALID":
        return "비밀번호가 틀렸어."
      case "RATE_LIMITED":
        return "너무 많이 시도했어. 잠시 후 다시 해줘."
      case "NOT_OWNER":
        return "권한이 없어."
      case "NOT_FOUND":
        return "대상을 찾을 수 없어."
      default:
        return null
    }
  }, [])

  const openPasswordModal = useCallback((action: PasswordAction) => {
    setPasswordValue("")
    setPasswordAction(action)
  }, [])

  const closePasswordModal = useCallback(() => {
    if (passwordSubmitting) return
    setPasswordAction(null)
    setPasswordValue("")
  }, [passwordSubmitting])

  const submitComment = async (parentId?: string) => {
    if (isLoggedIn && !canComment) {
      setError("온보딩을 완료해주세요.")
      return
    }

    const isGuest = !isLoggedIn
    const content = parentId ? replyBody.trim() : commentBody.trim()
    if (!content) {
      setError("내용을 입력해주세요.")
      return
    }
    if (isGuest) {
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
      const response = await fetch(`/api/posts/${postKey}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          parentId,
          ...(isGuest
            ? { guestNickname: guestNickname.trim(), guestPassword }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const mapped = mapPasswordCode(payload?.error?.code)
        setError(mapped ?? payload?.error?.message ?? "댓글을 등록할 수 없습니다.")
        return
      }

      if (parentId) {
        setReplyBody("")
        setActiveReplyId(null)
      } else {
        setCommentBody("")
      }

      await refreshComments()
    } finally {
      setSubmitting(false)
    }
  }

  const hasSelection = useCallback(() => {
    const selection = window.getSelection()
    return Boolean(selection && selection.toString().trim().length > 0)
  }, [])

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const interactive = target.closest(
      "a, button, input, textarea, select, [role=\"button\"], [data-no-reply-toggle]"
    )
    if (!interactive) return false
    if (interactive.getAttribute("data-reply-toggle") === "true") return false
    return true
  }, [])

  const wasDrag = useCallback(() => {
    const { dragged, elapsed } = pointerStateRef.current
    pointerStateRef.current.dragged = false
    pointerStateRef.current.elapsed = 0
    if (dragged) return true
    if (elapsed && elapsed > 250) return true
    return false
  }, [])

  const toggleReply = useCallback(
    (commentId: string) => {
      if (hasSelection()) return
      if (isLoggedIn && !canComment) {
        setActiveReplyId(null)
        setLoginPromptId((prev) => (prev === commentId ? null : commentId))
        return
      }
      setLoginPromptId(null)
      setActiveReplyId((prev) => {
        const next = prev === commentId ? null : commentId
        if (next !== prev) {
          setReplyBody("")
        }
        return next
      })
    },
    [canComment, hasSelection, isLoggedIn]
  )

  const clearPendingToggle = useCallback(() => {
    if (toggleTimerRef.current) {
      window.clearTimeout(toggleTimerRef.current)
      toggleTimerRef.current = null
    }
  }, [])

  const scheduleToggle = useCallback(
    (commentId: string) => {
      clearPendingToggle()
      toggleTimerRef.current = window.setTimeout(() => {
        toggleTimerRef.current = null
        toggleReply(commentId)
      }, 200)
    },
    [clearPendingToggle, toggleReply]
  )

  const startEditComment = useCallback((comment: CommentNode) => {
    setEditingCommentId(comment.id)
    setEditingBody(comment.content)
    setEditingPassword("")
    setEditingError(null)
  }, [])

  const cancelEditComment = useCallback(() => {
    setEditingCommentId(null)
    setEditingBody("")
    setEditingPassword("")
    setEditingError(null)
  }, [])

  const submitEditComment = useCallback(
    async (comment: CommentNode) => {
      if (!editingBody.trim()) {
        setEditingError("내용을 입력해주세요.")
        return
      }
      if (comment.authorIsGuest && !editingPassword) {
        setEditingError("비밀번호를 입력해줘.")
        return
      }
      if (comment.authorIsGuest && editingPassword.length < 4) {
        setEditingError("비밀번호는 4자 이상이야.")
        return
      }
      setEditingError(null)
      setCommentSavingId(comment.id)
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editingBody.trim(),
          ...(comment.authorIsGuest ? { guestPassword: editingPassword } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const mapped = mapPasswordCode(payload?.error?.code)
        setEditingError(mapped ?? payload?.error?.message ?? "수정할 수 없습니다.")
        setCommentSavingId(null)
        return
      }
      cancelEditComment()
      await refreshComments()
      setCommentSavingId(null)
    },
    [
      editingBody,
      editingPassword,
      refreshComments,
      cancelEditComment,
      mapPasswordCode,
    ]
  )

  const requestCommentDelete = useCallback(
    async (commentId: string, guestPassword?: string) => {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guestPassword ? { guestPassword } : {}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        return { ok: false, code: payload?.error?.code as string | undefined }
      }
      await refreshComments()
      return { ok: true as const }
    },
    [refreshComments]
  )

  const deleteComment = useCallback(
    (comment: CommentNode) => {
      if (comment.authorIsGuest && !isAdmin) {
        openPasswordModal({ type: "comment-delete", commentId: comment.id })
        return
      }
      setCommentDeletingId(comment.id)
      requestCommentDelete(comment.id)
        .then((result) => {
          setCommentDeletingId(null)
          if (!result.ok) {
            const mapped = mapPasswordCode(result.code)
            showToast(mapped ?? "삭제할 수 없습니다.")
            return
          }
          showToast("삭제됐어.")
        })
        .catch(() => {
          setCommentDeletingId(null)
          showToast("삭제할 수 없습니다.")
        })
    },
    [isAdmin, mapPasswordCode, openPasswordModal, requestCommentDelete, showToast]
  )

  const startPostEdit = useCallback(() => {
    setPostEditing(true)
    setPostEditTitle(postState.title)
    setPostEditBody(postState.body)
    setPostEditError(null)
  }, [postState])

  const cancelPostEdit = useCallback(() => {
    setPostEditing(false)
    setPostEditPassword("")
    setPostEditError(null)
  }, [])

  const submitPostEdit = useCallback(async () => {
    if (!postEditTitle.trim() || !postEditBody.trim()) {
      setPostEditError("제목과 내용을 입력해주세요.")
      return
    }
    if (postState.authorIsGuest && !isAdmin && !postEditPassword) {
      openPasswordModal({ type: "post-edit" })
      return
    }
    setPostSubmitting(true)
    setPostEditError(null)
    try {
      const response = await fetch(`/api/posts/${postKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: postEditTitle.trim(),
          body: postEditBody.trim(),
          ...(postState.authorIsGuest && !isAdmin
            ? { guestPassword: postEditPassword }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const code = payload?.error?.code as string | undefined
        const mapped = mapPasswordCode(code)
        if (mapped) {
          showToast(mapped)
          if (code === "PASSWORD_INVALID" || code === "PASSWORD_REQUIRED") {
            setPostEditPassword("")
            openPasswordModal({ type: "post-edit" })
          }
        } else {
          setPostEditError(payload?.error?.message ?? "수정할 수 없습니다.")
        }
        return
      }
      setPostState((prev) => ({
        ...prev,
        title: postEditTitle.trim(),
        body: postEditBody.trim(),
        editedAt: new Date().toISOString(),
      }))
      setPostEditing(false)
      setPostEditPassword("")
      showToast("수정됐어.")
    } finally {
      setPostSubmitting(false)
    }
  }, [
    mapPasswordCode,
    openPasswordModal,
    postEditBody,
    postEditPassword,
    postEditTitle,
    postKey,
    postState.authorIsGuest,
    isAdmin,
    showToast,
  ])

  const requestPostDelete = useCallback(
    async (guestPassword?: string) => {
      const response = await fetch(`/api/posts/${postKey}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guestPassword ? { guestPassword } : {}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        return { ok: false, code: payload?.error?.code as string | undefined }
      }
      return { ok: true as const }
    },
    [postKey]
  )

  const deletePost = useCallback(() => {
    if (postState.authorIsGuest && !isAdmin) {
      openPasswordModal({ type: "post-delete" })
      return
    }
    setPostDeleting(true)
    requestPostDelete()
      .then((result) => {
        setPostDeleting(false)
        if (!result.ok) {
          const mapped = mapPasswordCode(result.code)
          showToast(mapped ?? "삭제할 수 없습니다.")
          return
        }
        showToast("삭제됐어.")
        window.setTimeout(() => {
          router.push(`/b/${postState.board.slug}`)
          router.refresh()
        }, 200)
      })
      .catch(() => {
        setPostDeleting(false)
        showToast("삭제할 수 없습니다.")
      })
  }, [
    mapPasswordCode,
    openPasswordModal,
    postState.authorIsGuest,
    postState.board.slug,
    requestPostDelete,
    router,
    showToast,
    isAdmin,
  ])

  const confirmPasswordAction = useCallback(async () => {
    if (!passwordAction) return
    const password = passwordValue.trim()
    if (!password) {
      showToast("비밀번호를 입력해줘.")
      passwordInputRef.current?.focus()
      return
    }
    if (password.length < 4) {
      showToast("비밀번호는 4자 이상이야.")
      passwordInputRef.current?.focus()
      return
    }
    setPasswordSubmitting(true)
    try {
      if (passwordAction.type === "post-edit") {
        setPostEditPassword(password)
        startPostEdit()
        closePasswordModal()
        return
      }
      if (passwordAction.type === "post-delete") {
        const result = await requestPostDelete(password)
        if (!result.ok) {
          const mapped = mapPasswordCode(result.code)
          showToast(mapped ?? "삭제할 수 없습니다.")
          setPasswordValue("")
          return
        }
        closePasswordModal()
        showToast("삭제됐어.")
        window.setTimeout(() => {
          router.push(`/b/${postState.board.slug}`)
          router.refresh()
        }, 200)
        return
      }
      if (passwordAction.type === "comment-delete") {
        const result = await requestCommentDelete(
          passwordAction.commentId,
          password
        )
        if (!result.ok) {
          const mapped = mapPasswordCode(result.code)
          showToast(mapped ?? "삭제할 수 없습니다.")
          setPasswordValue("")
          return
        }
        closePasswordModal()
        showToast("삭제됐어.")
      }
    } finally {
      setPasswordSubmitting(false)
    }
  }, [
    closePasswordModal,
    mapPasswordCode,
    passwordAction,
    passwordValue,
    postState.board.slug,
    requestCommentDelete,
    requestPostDelete,
    router,
    showToast,
    startPostEdit,
  ])

  const renderComment = (comment: CommentNode, depth = 0) => {
    const isActive = activeReplyId === comment.id
    const showLoginPrompt =
      isLoggedIn && !canComment && loginPromptId === comment.id
    const isEditing = editingCommentId === comment.id
    const isDeleted =
      comment.status === "DELETED" || Boolean(comment.deletedAt)
    const canEdit =
      !isDeleted &&
      comment.authorKind !== "AGENT" &&
      (comment.isOwner || comment.authorIsGuest)
    const canDelete = !isDeleted && (canEdit || isAdmin)
    const rowClass = `km-post-comment km-comment-row ${
      depth ? "is-reply" : ""
    }`
    const authorHref = comment.authorId
      ? `/b/${postState.board.slug}?authorId=${encodeURIComponent(
          comment.authorId
        )}&author=${encodeURIComponent(comment.authorName)}&scope=author`
      : `/search?scope=author&q=${encodeURIComponent(comment.authorName)}`
    return (
      <div
        key={comment.id}
        className={rowClass}
        style={{ marginLeft: depth ? `${depth * 16}px` : undefined }}
        data-testid="comment-row"
      >
        <div
          className="km-post-comment-meta km-comment-header"
          data-testid="comment-header"
        >
          <span className="km-comment-author" data-testid="comment-author">
            <Link
              className="km-comment-author-link"
              href={authorHref}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              data-no-reply-toggle
              data-testid="author-search-link"
            >
              <AuthorLabel
                displayName={comment.authorName}
                authorType={
                  comment.authorIsGuest
                    ? "guest"
                    : comment.authorKind === "AGENT"
                      ? "agent"
                      : "user"
                }
              />
            </Link>
          </span>
          {comment.authorKind === "AGENT" ? <AgentBadge /> : null}
          <span className="km-comment-time" data-testid="comment-meta-time">
            {formatDate(String(comment.createdAt))}
            {comment.editedAt && !isDeleted ? " (수정됨)" : ""}
          </span>
          {canEdit || canDelete ? (
            <span className="km-comment-actions" data-no-reply-toggle>
              {canEdit ? (
                <button
                  type="button"
                  className="km-comment-action"
                  onClick={(event) => {
                    event.stopPropagation()
                    startEditComment(comment)
                  }}
                >
                  수정
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className="km-comment-action km-comment-action-icon"
                  onClick={(event) => {
                    event.stopPropagation()
                    deleteComment(comment)
                  }}
                  aria-label="댓글 삭제"
                  title="삭제"
                  disabled={commentDeletingId === comment.id}
                >
                  ×
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        <div
          className="km-post-comment-body km-comment-body"
          data-testid="comment-body"
          data-reply-toggle="true"
          role="button"
          tabIndex={0}
          aria-expanded={isActive}
          aria-controls={`reply-${comment.id}`}
          onPointerDown={(event) => {
            pointerStateRef.current = {
              x: event.clientX,
              y: event.clientY,
              time: Date.now(),
              elapsed: 0,
              active: true,
              dragged: false,
            }
          }}
          onPointerUp={(event) => {
            if (!pointerStateRef.current.active) return
            const dx = event.clientX - pointerStateRef.current.x
            const dy = event.clientY - pointerStateRef.current.y
            const distance = Math.hypot(dx, dy)
            pointerStateRef.current.active = false
            pointerStateRef.current.dragged = distance > 10
            pointerStateRef.current.elapsed =
              Date.now() - pointerStateRef.current.time
          }}
          onPointerCancel={() => {
            pointerStateRef.current.active = false
            pointerStateRef.current.dragged = false
            pointerStateRef.current.elapsed = 0
          }}
          onClick={(event) => {
            if (event.detail > 1) {
              clearPendingToggle()
              return
            }
            if (wasDrag()) return
            if (hasSelection()) return
            if (isInteractiveTarget(event.target)) return
            scheduleToggle(comment.id)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            if (hasSelection()) return
            if (isInteractiveTarget(event.target)) return
            event.preventDefault()
            clearPendingToggle()
            toggleReply(comment.id)
          }}
        >
          {isDeleted ? (
            <p className="km-comment-deleted">삭제된 댓글입니다</p>
          ) : isEditing ? (
            <div className="km-comment-edit" data-no-reply-toggle>
              <textarea
                className="km-comment-input"
                value={editingBody}
                onChange={(event) => setEditingBody(event.target.value)}
              />
              {comment.authorIsGuest ? (
                <input
                  className="km-comment-password"
                  type="password"
                  placeholder="비밀번호"
                  value={editingPassword}
                  onChange={(event) => setEditingPassword(event.target.value)}
                />
              ) : null}
              {editingError ? (
                <p className="km-comment-error">{editingError}</p>
              ) : null}
              <div className="km-comment-edit-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={(event) => {
                    event.stopPropagation()
                    submitEditComment(comment)
                  }}
                  disabled={commentSavingId === comment.id}
                >
                  저장
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={(event) => {
                    event.stopPropagation()
                    cancelEditComment()
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            comment.content
          )}
        </div>
        {showLoginPrompt ? (
          <div className="km-comment-login" data-no-reply-toggle>
            <span>온보딩을 완료해줘.</span>
            <Link className="km-comment-login-link" href="/onboarding">
              온보딩하기
            </Link>
          </div>
        ) : null}
        {isActive ? (
          <div
            className="km-post-reply km-reply-composer"
            data-testid="reply-composer"
            id={`reply-${comment.id}`}
          >
            <div className="km-reply-target">
              @{comment.authorName}에게 답글
            </div>
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
                    placeholder="비밀번호(삭제용)"
                    required
                  />
                </label>
              </div>
            ) : null}
            <textarea
              rows={3}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="댓글을 입력해줘"
              aria-label="댓글 입력"
              required
              autoFocus
            />
            <div className="km-reply-actions">
              <button
                className="km-comment-action km-comment-action-primary"
                type="button"
                disabled={submitting}
                onClick={() => submitComment(comment.id)}
              >
                {submitting ? "처리 중…" : "등록"}
              </button>
              <button
                className="km-comment-action km-comment-action-ghost"
                type="button"
                onClick={() => setActiveReplyId(null)}
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
        {comment.replies.length > 0 ? (
          <div className="km-post-replies">
            {comment.replies.map((reply) => renderComment(reply, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="container km-post" data-testid="post-detail">
      <section className="km-post-shell">
        <Link
          className="km-post-back"
          href={`/b/${postState.board.slug}`}
          data-testid="post-back"
        >
          ← 보드로 돌아가기
        </Link>
        {toast ? (
          <p className="km-toast" role="status" aria-live="polite">
            {toast}
          </p>
        ) : null}

        <header className="km-post-header">
          <h1 className="km-post-title" data-testid="post-title">
            {postState.title}
            {postState.authorKind === "AGENT" ? <AgentBadge /> : null}
          </h1>
          <div className="km-post-meta" data-testid="post-meta">
            <Link className="km-post-board" href={`/b/${postState.board.slug}`}>
              {postState.board.titleKo}
            </Link>
            <AuthorLabel
              displayName={postState.authorName}
              authorType={
                postState.authorIsGuest
                  ? "guest"
                  : postState.authorKind === "AGENT"
                    ? "agent"
                    : "user"
              }
            />
            <span>
              {formatDate(postState.createdAt)}
              {postState.editedAt ? " (수정됨)" : ""}
            </span>
            <span>조회 {postState.viewCount}</span>
          </div>
          {canManagePost ? (
            <div className="km-post-actions">
              <button
                type="button"
                className="km-post-action"
                onClick={() =>
                  postState.authorIsGuest
                    ? openPasswordModal({ type: "post-edit" })
                    : startPostEdit()
                }
              >
                수정
              </button>
              <button
                type="button"
                className="km-post-action"
                onClick={deletePost}
                disabled={postDeleting}
              >
                삭제
              </button>
            </div>
          ) : null}
        </header>

        {postEditing ? (
          <div className="km-post-edit" data-testid="post-content">
            <input
              className="km-post-edit-title"
              value={postEditTitle}
              onChange={(event) => setPostEditTitle(event.target.value)}
              placeholder="제목"
            />
            <textarea
              className="km-post-edit-body"
              rows={8}
              value={postEditBody}
              onChange={(event) => setPostEditBody(event.target.value)}
              placeholder="내용"
            />
            {postEditError ? (
              <p className="km-post-error">{postEditError}</p>
            ) : null}
            <div className="km-post-edit-actions">
              <button
                className="km-post-action km-post-action-primary"
                type="button"
                disabled={postSubmitting}
                onClick={submitPostEdit}
              >
                저장
              </button>
              <button
                className="km-post-action"
                type="button"
                onClick={cancelPostEdit}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="km-post-content" data-testid="post-content">
            {postState.body}
          </div>
        )}

        <div className="km-post-vote" data-testid="post-vote-bar">
          <VoteButtons
            targetType="post"
            targetId={postState.id}
            initialUp={postVotes.up}
            initialDown={postVotes.down}
            initialMyVote={postVotes.myVote}
            canVote={canVote}
          />
        </div>

        <section
          className="km-post-comments km-comments"
          data-testid="comments-section"
        >
          <div className="km-post-comments-header">
            <h2>댓글 {commentCount}</h2>
            <p>{commentHint}</p>
          </div>

          {commentList.length === 0 ? (
            <div className="km-post-empty">
              <p>댓글이 없어.</p>
            </div>
          ) : (
            <div className="km-post-comment-list" data-testid="comments-list">
              {commentList.map((comment) => renderComment(comment))}
            </div>
          )}

          {showCommentForm ? (
            <form
              className="km-post-form"
              data-testid="comment-composer"
              onSubmit={(event) => {
                event.preventDefault()
                submitComment()
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
                      placeholder="비밀번호(삭제용)"
                      required
                    />
                  </label>
                </div>
              ) : null}
              <label className="km-post-field">
                <span>댓글</span>
                <textarea
                  rows={4}
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="댓글을 입력해줘"
                  required
                />
              </label>
              {error ? <p className="km-post-error">{error}</p> : null}
              <button
                className="km-post-action km-post-action-primary"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "처리 중…" : "댓글쓰기"}
              </button>
            </form>
          ) : (
            <div className="km-post-login">
              <p>온보딩을 완료하면 댓글을 쓸 수 있어.</p>
              <Link className="km-post-action" href="/onboarding">
                온보딩하기
              </Link>
            </div>
          )}

          {!isLoggedIn ? (
            <div className="km-post-login km-post-login-guest">
              <p>로그인하면 내 댓글을 쉽게 관리할 수 있어.</p>
              <Link className="km-post-action" href="/login">
                로그인하기
              </Link>
            </div>
          ) : null}
        </section>

        <section className="km-post-bottom" data-testid="post-bottom-list">
          <div className="km-post-bottom-header">다른 글</div>
          {relatedPosts.length === 0 ? (
            <div className="km-post-empty">
              <p>다른 글이 없어.</p>
            </div>
          ) : (
            <div className="km-post-bottom-table">
              <div className="km-post-bottom-row is-head">
                <span>제목</span>
                <span>댓글</span>
                <span>추천</span>
                <span>조회</span>
                <span>날짜</span>
              </div>
              {relatedPosts.map((item) => (
                <Link
                  key={item.id}
                  className="km-post-bottom-row"
                  href={`/p/${item.id}`}
                >
                  <span className="km-post-bottom-title">{item.title}</span>
                  <span>{item.commentCount}</span>
                  <span>{item.upCount}</span>
                  <span>{item.viewCount}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {passwordAction ? (
          <div
            className="km-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-modal-title"
          >
            <div
              className="km-modal-overlay"
              onClick={closePasswordModal}
            />
            <div
              className="km-modal-card"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation()
                  closePasswordModal()
                }
                if (event.key === "Enter") {
                  event.preventDefault()
                  confirmPasswordAction()
                }
              }}
            >
              <div className="km-modal-header">
                <h3 id="password-modal-title">비밀번호 입력</h3>
              </div>
              <div className="km-modal-body">
                <p>작성할 때 설정한 비밀번호를 입력해줘.</p>
                <input
                  ref={passwordInputRef}
                  type="password"
                  placeholder="비밀번호"
                  value={passwordValue}
                  onChange={(event) => setPasswordValue(event.target.value)}
                  disabled={passwordSubmitting}
                />
              </div>
              <div className="km-modal-footer">
                <button
                  className="km-button km-button-outline"
                  type="button"
                  onClick={closePasswordModal}
                  disabled={passwordSubmitting}
                >
                  취소
                </button>
                <button
                  className="km-button km-button-primary"
                  type="button"
                  onClick={confirmPasswordAction}
                  disabled={passwordSubmitting}
                >
                  {passwordSubmitting ? "처리 중…" : "확인"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
