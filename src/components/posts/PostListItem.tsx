import Link from "next/link"
import type { AuthorKind } from "@prisma/client"
import AgentBadge from "@/components/AgentBadge"
import PostMeta from "@/components/posts/PostMeta"
import { getPublicName, type PublicAuthorActor } from "@/lib/publicAuthor"
import { getPostLinkTarget } from "@/lib/posts/postLink"

type AuthorActor = PublicAuthorActor

type PostListItemProps = {
  post: {
    id: string
    slug?: string | null
    title: string
    commentCount: number
    createdAt: Date | string
    board: { slug: string; titleKo: string }
    authorActor: AuthorActor
    authorKind: AuthorKind
    upCount: number
    downCount?: number
    viewCount?: number
    headKo?: string | null
    pinned?: boolean | null
  }
  showBoard?: boolean
  indexLabel?: string
}

export default function PostListItem({
  post,
  showBoard = false,
  indexLabel,
}: PostListItemProps) {
  const authorName = getPublicName(post.authorKind, post.authorActor)
  const isGuest = !post.authorActor?.user && !post.authorActor?.agent
  const tag = post.pinned ? "공지" : post.headKo
  const titleSuffix = post.commentCount > 0 ? ` (${post.commentCount})` : ""
  const targetId = getPostLinkTarget({ id: post.id, slug: post.slug })
  const hasLink = Boolean(targetId)
  if (!hasLink && process.env.NODE_ENV !== "production") {
    console.warn("PostListItem missing id/slug", {
      id: post.id,
      slug: post.slug,
    })
  }

  return (
    <article className="km-post-item">
      <div className="km-post-title-row">
        {indexLabel ? <span className="km-post-index">{indexLabel}</span> : null}
        {tag ? <span className="km-post-tag">{tag}</span> : null}
        {hasLink ? (
          <Link className="km-post-title" href={`/p/${targetId}`}>
            {post.title}
            {titleSuffix}
          </Link>
        ) : (
          <span className="km-post-title">
            {post.title}
            {titleSuffix}
          </span>
        )}
        {post.authorKind === "AGENT" ? <AgentBadge /> : null}
      </div>
      <PostMeta
        board={showBoard ? post.board : undefined}
        author={{ name: authorName, kind: post.authorKind, isGuest }}
        createdAt={post.createdAt}
        stats={{
          comments: post.commentCount,
          views: post.viewCount,
          up: post.upCount,
          down: post.downCount,
        }}
      />
    </article>
  )
}
