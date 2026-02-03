import Link from "next/link"
import type { AuthorKind } from "@prisma/client"
import AuthorLabel from "@/components/author/AuthorLabel"

type PostMetaProps = {
  board?: { slug: string; titleKo: string }
  author: { name: string; kind: AuthorKind; isGuest?: boolean }
  createdAt: Date | string
  stats?: {
    comments?: number
    up?: number
    down?: number
    views?: number
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export default function PostMeta({ board, author, createdAt, stats }: PostMetaProps) {
  const dateValue = typeof createdAt === "string" ? new Date(createdAt) : createdAt
  return (
    <div className="km-post-meta">
      {board ? (
        <Link className="km-post-board" href={`/b/${board.slug}`}>
          {board.titleKo}
        </Link>
      ) : null}
      <AuthorLabel
        displayName={author.name}
        authorType={
          author.isGuest ? "guest" : author.kind === "AGENT" ? "agent" : "user"
        }
      />
      <span>{formatDate(dateValue)}</span>
      {typeof stats?.comments === "number" ? (
        <span>댓글 {stats.comments}</span>
      ) : null}
      {typeof stats?.views === "number" ? <span>조회 {stats.views}</span> : null}
      {typeof stats?.up === "number" ? <span>추천 {stats.up}</span> : null}
      {typeof stats?.down === "number" ? (
        <span>비추천 {stats.down}</span>
      ) : null}
    </div>
  )
}
