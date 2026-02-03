import { Prisma } from "@prisma/client"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { buildCommentThread, type CommentNode } from "@/lib/comments/thread"
import { getOrCreateActorForUser } from "@/lib/actors"
import { resolvePostByKey } from "@/lib/posts/resolvePostByKey"
import { logAudit } from "@/lib/audit"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import { validateRequiredParam } from "@/lib/validateRouteParam"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isAdmin } from "@/lib/auth/isAdmin"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { verifyPassword } from "@/lib/auth/password"
import { recordPasswordFailure } from "@/lib/security/passwordGuard"
import { applyContentConfiscation } from "@/lib/points/ledger"

const AUTHOR_INCLUDE = PUBLIC_AUTHOR_INCLUDE

type UpdatePayload = {
  title?: string
  body?: string
  head?: string
  guestPassword?: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const startedAt = Date.now()
  const { key: rawKey } = await params
  const paramKey = validateRequiredParam(rawKey)
  if (!paramKey) {
    return jsonError(400, "VALIDATION_ERROR", "게시글 키가 필요합니다.")
  }
  type PostWithAuthor = Prisma.PostGetPayload<{
    include: {
      board: true
      authorActor: { include: typeof AUTHOR_INCLUDE }
    }
  }>

  const { key, post: rawPost, lookup } = await resolvePostByKey(prisma, paramKey, {
    include: {
      board: true,
      authorActor: { include: AUTHOR_INCLUDE },
    },
  })
  const post = rawPost as PostWithAuthor | null

  if (!post || post.status !== "VISIBLE") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[post not found] key=${key} lookup=${lookup}`)
    }
    await logAudit({
      prisma,
      actorType: "ANON",
      endpoint: `/api/posts/${key}`,
      method: "GET",
      statusCode: 404,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const viewCount = post.viewCount

  const comments = await prisma.comment.findMany({
    where: { postId: post.id, status: { in: ["VISIBLE", "DELETED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      authorActor: { include: AUTHOR_INCLUDE },
    },
  })

  let postMyVote: -1 | 0 | 1 = 0
  const commentVotes = new Map<string, -1 | 0 | 1>()

  if (userId) {
    const actor = await getOrCreateActorForUser(prisma, userId)
    const commentIds = comments.map((comment) => comment.id)
    const votes = await prisma.vote.findMany({
      where: {
        voterActorId: actor.id,
        OR: [
          { targetType: "POST", targetId: post.id },
          {
            targetType: "COMMENT",
            targetId: { in: commentIds.length ? commentIds : ["_"] },
          },
        ],
      },
    })

    for (const vote of votes) {
      if (vote.targetType === "POST") {
        postMyVote = vote.value as -1 | 0 | 1
      } else {
        commentVotes.set(vote.targetId, vote.value as -1 | 0 | 1)
      }
    }
  }

  const authorName = getPublicName(post.authorKind, post.authorActor)
  const postIsGuest =
    post.authorType === "guest" ||
    (!post.authorActor?.userId && !post.authorActor?.agentId)
  const postIsOwner = Boolean(userId && post.authorActor?.userId === userId)

  const commentRecords = comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    status: comment.status,
    authorId: comment.authorActorId,
    authorName: getPublicName(comment.authorKind, comment.authorActor),
    authorKind: comment.authorKind,
    authorIsGuest:
      comment.authorType === "guest" ||
      (!comment.authorActor?.userId && !comment.authorActor?.agentId),
    isOwner: Boolean(userId && comment.authorActor?.userId === userId),
    upCount: comment.upCount,
    downCount: comment.downCount,
    myVote: commentVotes.get(comment.id) ?? 0,
  }))

  const commentTree = buildCommentThread(commentRecords)

  type CommentResponse = {
    id: string
    content: string
    createdAt: string | Date
    editedAt?: string | Date | null
    deletedAt?: string | Date | null
    status?: "VISIBLE" | "HIDDEN" | "DELETED"
    authorId?: string | null
    author: {
      name: string
      isAi: boolean
      kind: "HUMAN" | "AGENT"
      isGuest?: boolean
    }
    isOwner?: boolean
    votes: { up: number; down: number; myVote: number }
    replies: CommentResponse[]
  }

  const serializeComment = (node: CommentNode): CommentResponse => ({
    id: node.id,
    content: node.content,
    createdAt: node.createdAt,
    editedAt: node.editedAt ?? null,
    deletedAt: node.deletedAt ?? null,
    status: node.status ?? "VISIBLE",
    authorId: node.authorId ?? null,
    author: {
      name: node.authorName,
      kind: node.authorKind,
      isAi: node.authorKind === "AGENT",
      isGuest: node.authorIsGuest,
    },
    isOwner: node.isOwner ?? false,
    votes: { up: node.upCount, down: node.downCount, myVote: node.myVote },
    replies: node.replies.map(serializeComment),
  })

  const response = jsonOk({
    post: {
      id: post.id,
      board: { slug: post.board.slug, titleKo: post.board.titleKo },
      headKo: post.headKo,
      title: post.title,
      body: post.body,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
      viewCount,
      upCount: post.upCount,
      downCount: post.downCount,
      commentCount: post.commentCount,
      pinned: post.pinned,
      authorKind: post.authorKind,
      author: {
        name: authorName,
        kind: post.authorKind,
        isAi: post.authorKind === "AGENT",
        isGuest: postIsGuest,
      },
      isOwner: postIsOwner,
    },
    votes: { up: post.upCount, down: post.downCount, myVote: postMyVote },
    comments: commentTree.map(serializeComment),
  })

  await logAudit({
    prisma,
    actorType: userId ? "HUMAN" : "ANON",
    actorId: userId ?? null,
    endpoint: `/api/posts/${key}`,
    method: "GET",
    statusCode: 200,
    ip: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    latencyMs: Date.now() - startedAt,
  })

  return response
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { key: rawKey } = await params
    const paramKey = validateRequiredParam(rawKey)
    if (!paramKey) {
      return jsonError(400, "VALIDATION_ERROR", "게시글 키가 필요합니다.")
    }

    const payload = await readJsonWithLimit<UpdatePayload>(request)
    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const title = payload.title?.trim() ?? ""
    const body = payload.body?.trim() ?? ""
    const headKo = payload.head?.trim() ?? ""
    const guestPassword = payload.guestPassword ?? ""

    if (!title || !body) {
      return jsonError(422, "VALIDATION_ERROR", "필수 항목을 입력해주세요.")
    }

    const { key, post: rawPost } = await resolvePostByKey(prisma, paramKey, {
      include: {
        authorActor: true,
      },
    })
    const post = rawPost as {
      id: string
      status: string
      authorActorId: string
      authorType: string | null
      guestPwHash: string | null
      authorActor: { userId: string | null; agentId: string | null; guestPasswordHash: string | null }
    } | null

    if (!post || post.status !== "VISIBLE") {
      return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
    }

    const user = await getSessionUser()
    const isOwner = Boolean(user && post.authorActor.userId === user.id)
    const admin = isAdmin(user)
    const isGuest =
      post.authorType === "guest" ||
      (!post.authorActor.userId && !post.authorActor.agentId)

    if (!isOwner && !admin) {
      if (!isGuest) {
        return jsonError(403, "NOT_OWNER", "수정 권한이 없습니다.")
      }
      if (!guestPassword) {
        return jsonError(422, "PASSWORD_REQUIRED", "비밀번호를 입력해주세요.")
      }
      const storedHash =
        post.guestPwHash ?? post.authorActor.guestPasswordHash
      if (!storedHash) {
        return jsonError(403, "NOT_OWNER", "수정 권한이 없습니다.")
      }
      const ok = await verifyPassword(guestPassword, storedHash)
      if (!ok) {
        const { ip } = getClientIp(request)
        const rl = await recordPasswordFailure({
          ip,
          resourceKey: `post:${post.id}`,
        })
        if (!rl.ok) {
          return jsonErrorWithHeaders(
            429,
            "RATE_LIMITED",
            "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
            { retryAfterSeconds: rl.retryAfterSec },
            { "Retry-After": String(rl.retryAfterSec) }
          )
        }
        return jsonError(403, "PASSWORD_INVALID", "비밀번호가 올바르지 않습니다.")
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        title,
        body,
        headKo: headKo || null,
        editedAt: new Date(),
      },
    })

    await logAudit({
      prisma,
      actorType: user ? "HUMAN" : "ANON",
      actorId: user?.id ?? null,
      endpoint: `/api/posts/${key}`,
      method: "PATCH",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return jsonOk({ ok: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { key: rawKey } = await params
    const paramKey = validateRequiredParam(rawKey)
    if (!paramKey) {
      return jsonError(400, "VALIDATION_ERROR", "게시글 키가 필요합니다.")
    }

    const payload = await readJsonWithLimit<UpdatePayload>(request)
    const guestPassword = payload?.guestPassword ?? ""

    const { key, post: rawPost } = await resolvePostByKey(prisma, paramKey, {
      include: {
        authorActor: true,
      },
    })
    const post = rawPost as {
      id: string
      status: string
      authorActorId: string
      authorType: string | null
      guestPwHash: string | null
      authorActor: { userId: string | null; agentId: string | null; guestPasswordHash: string | null }
    } | null

    if (!post || post.status !== "VISIBLE") {
      return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
    }

    const user = await getSessionUser()
    const isOwner = Boolean(user && post.authorActor.userId === user.id)
    const admin = isAdmin(user)
    const isGuest =
      post.authorType === "guest" ||
      (!post.authorActor.userId && !post.authorActor.agentId)

    if (!isOwner && !admin) {
      if (!isGuest) {
        return jsonError(403, "NOT_OWNER", "삭제 권한이 없습니다.")
      }
      if (!guestPassword) {
        return jsonError(422, "PASSWORD_REQUIRED", "비밀번호를 입력해주세요.")
      }
      const storedHash =
        post.guestPwHash ?? post.authorActor.guestPasswordHash
      if (!storedHash) {
        return jsonError(403, "NOT_OWNER", "삭제 권한이 없습니다.")
      }
      const ok = await verifyPassword(guestPassword, storedHash)
      if (!ok) {
        const { ip } = getClientIp(request)
        const rl = await recordPasswordFailure({
          ip,
          resourceKey: `post:${post.id}`,
        })
        if (!rl.ok) {
          return jsonErrorWithHeaders(
            429,
            "RATE_LIMITED",
            "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
            { retryAfterSeconds: rl.retryAfterSec },
            { "Retry-After": String(rl.retryAfterSec) }
          )
        }
        return jsonError(403, "PASSWORD_INVALID", "비밀번호가 올바르지 않습니다.")
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: post.id },
        data: { status: "DELETED", deletedAt: new Date() },
      })
      await applyContentConfiscation({
        tx,
        targetType: "POST",
        targetId: post.id,
        authorActorId: post.authorActorId,
      })
    })

    await logAudit({
      prisma,
      actorType: user ? "HUMAN" : "ANON",
      actorId: user?.id ?? null,
      endpoint: `/api/posts/${key}`,
      method: "DELETE",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return jsonOk({ ok: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
