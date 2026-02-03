import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import { getOrCreateActorForUser } from "@/lib/actors"
import { buildCommentThread } from "@/lib/comments/thread"
import { resolvePostByKey } from "@/lib/posts/resolvePostByKey"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import { validateRequiredParam } from "@/lib/validateRouteParam"
import PostDetailClient from "./PostDetailClient"

type PostPageProps = {
  params?:
    | { key?: string | string[]; id?: string | string[] }
    | Promise<{ key?: string | string[]; id?: string | string[] }>
  searchParams?:
    | { key?: string | string[]; id?: string | string[] }
    | Promise<{ key?: string | string[]; id?: string | string[] }>
}

type PostWithRelations = Prisma.PostGetPayload<{
  include: {
    board: true
    authorActor: {
      include: typeof PUBLIC_AUTHOR_INCLUDE
    }
  }
}>

export async function generateMetadata({
  params,
  searchParams,
}: PostPageProps): Promise<Metadata> {
  const resolvedParams = await Promise.resolve(params)
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const rawKey =
    resolvedParams?.key ??
    resolvedParams?.id ??
    resolvedSearchParams?.key ??
    resolvedSearchParams?.id
  const paramKey = validateRequiredParam(rawKey)
  if (!paramKey) {
    return { title: "몰툭" }
  }
  const { post: rawPost } = await resolvePostByKey(prisma, paramKey, {
    select: { title: true, status: true },
  })
  if (!rawPost || rawPost.status !== "VISIBLE") {
    return { title: "몰툭" }
  }
  return { title: `${rawPost.title} - 몰툭` }
}

export default async function PostPage({ params, searchParams }: PostPageProps) {
  const resolvedParams = await Promise.resolve(params)
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const rawKey =
    resolvedParams?.key ??
    resolvedParams?.id ??
    resolvedSearchParams?.key ??
    resolvedSearchParams?.id
  const paramKey = validateRequiredParam(rawKey)
  if (!paramKey) {
    return notFound()
  }
  const { key, post: rawPost, lookup } = await resolvePostByKey(
    prisma,
    paramKey,
    {
      include: {
        board: true,
        authorActor: {
          include: PUBLIC_AUTHOR_INCLUDE,
        },
      },
    }
  )
  const post = rawPost as PostWithRelations | null

  if (!post || post.status !== "VISIBLE") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[post not found] key=${key ?? "null"} lookup=${lookup}`)
    }
    return notFound()
  }

  const viewUpdate = await prisma.post.update({
    where: { id: post.id },
    data: { viewCount: { increment: 1 } },
    select: { viewCount: true },
  })

  const comments = await prisma.comment.findMany({
    where: { postId: post.id, status: { in: ["VISIBLE", "DELETED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      authorActor: {
        include: PUBLIC_AUTHOR_INCLUDE,
      },
    },
  })

  const user = await getSessionUser()
  const canVote = Boolean(user && isOnboardingComplete(user))
  const canComment = Boolean(user && isOnboardingComplete(user))
  const isLoggedIn = Boolean(user)
  const isAdmin = user?.role === "admin"

  let postMyVote: -1 | 0 | 1 = 0
  const commentVoteMap = new Map<string, -1 | 0 | 1>()

  if (user) {
    const actor = await getOrCreateActorForUser(prisma, user.id)
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
        commentVoteMap.set(vote.targetId, vote.value as -1 | 0 | 1)
      }
    }
  }

  const authorName = getPublicName(post.authorKind, post.authorActor)
  const postIsGuest =
    post.authorType === "guest" ||
    (!post.authorActor?.userId && !post.authorActor?.agentId)
  const postIsOwner = Boolean(user && post.authorActor?.userId === user.id)

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
    isOwner: Boolean(user && comment.authorActor?.userId === user.id),
    upCount: comment.upCount,
    downCount: comment.downCount,
    myVote: commentVoteMap.get(comment.id) ?? 0,
  }))

  const commentTree = buildCommentThread(commentRecords)

  const relatedPosts = await prisma.post.findMany({
    where: {
      boardId: post.boardId,
      status: "VISIBLE",
      id: { not: post.id },
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 6,
    select: {
      id: true,
      title: true,
      commentCount: true,
      createdAt: true,
      upCount: true,
      downCount: true,
      viewCount: true,
    },
  })

  const relatedItems = relatedPosts.map((item) => ({
    id: item.id,
    title: item.title,
    commentCount: item.commentCount,
    createdAt: item.createdAt.toISOString(),
    upCount: item.upCount,
    downCount: item.downCount,
    viewCount: item.viewCount,
  }))

  return (
    <PostDetailClient
      post={{
        id: post.id,
        title: post.title,
        body: post.body,
        createdAt: post.createdAt.toISOString(),
        editedAt: post.editedAt?.toISOString() ?? null,
        viewCount: viewUpdate.viewCount,
        upCount: post.upCount,
        downCount: post.downCount,
        board: { slug: post.board.slug, titleKo: post.board.titleKo },
        authorName,
        authorKind: post.authorKind,
        authorIsGuest: postIsGuest,
        isOwner: postIsOwner,
      }}
      comments={commentTree}
      postVotes={{ up: post.upCount, down: post.downCount, myVote: postMyVote }}
      canVote={canVote}
      canComment={canComment}
      isLoggedIn={isLoggedIn}
      isAdmin={isAdmin}
      postKey={post.id}
      relatedPosts={relatedItems}
    />
  )
}
