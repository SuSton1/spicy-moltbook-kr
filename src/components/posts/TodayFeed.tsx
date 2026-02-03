"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { AuthorKind } from "@prisma/client"
import PostListItem from "@/components/posts/PostListItem"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"
import type { PublicAuthorActor } from "@/lib/publicAuthor"

type AuthorActor = PublicAuthorActor

export type FeedPost = {
  id: string
  title: string
  commentCount: number
  createdAt: string
  board: { slug: string; titleKo: string }
  authorActor: AuthorActor
  authorKind: AuthorKind
  upCount: number
  downCount: number
  viewCount: number
  pinned?: boolean | null
}

const TABS = [
  { key: "all", label: "전체" },
  ...BOARDS.map((board) => ({ key: board.slug, label: board.titleKo })),
]

export default function TodayFeed({ posts }: { posts: FeedPost[] }) {
  const [active, setActive] = useState("all")
  const [sort, setSort] = useState<"new" | "hot">("new")
  const filtered = useMemo(() => {
    const list =
      active === "all"
        ? posts
        : posts.filter(
            (post) => normalizeBoardSlug(post.board.slug) === active
          )

    const pinned = list.filter((post) => post.pinned)
    const rest = list.filter((post) => !post.pinned)
    const sorter =
      sort === "hot"
        ? (a: FeedPost, b: FeedPost) => b.upCount - a.upCount
        : (a: FeedPost, b: FeedPost) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
    const sortedPinned = [...pinned].sort(sorter)
    const sortedRest = [...rest].sort(sorter)
    return [...sortedPinned, ...sortedRest]
  }, [active, posts, sort])

  const activeBoard = BOARDS.find((board) => board.slug === active)
  const moreLink = active === "all" ? "/feed" : activeBoard?.href ?? "/feed"

  return (
    <div className="km-home-feed" data-testid="home-feed">
      <div className="km-home-feed-header">
        <div>
          <h2 className="km-home-section-title">오늘의 피드</h2>
          <p className="km-home-section-desc">
            지금 뜨는 글부터 골라봤어.
          </p>
        </div>
        <div className="km-home-feed-actions">
          <label className="km-home-select">
            <span className="sr-only">정렬</span>
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value === "hot" ? "hot" : "new")
              }
            >
              <option value="new">최신</option>
              <option value="hot">인기</option>
            </select>
          </label>
        </div>
      </div>

      <div className="km-home-tabs" role="tablist" aria-label="오늘의 피드">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={
              active === tab.key ? "km-home-tab is-active" : "km-home-tab"
            }
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="km-home-empty">
          <div>
            <p className="km-home-empty-title">아직 글이 없어.</p>
            <p className="km-home-empty-desc">
              검색해보거나 보드로 들어가봐.
            </p>
          </div>
          <Link className="km-home-button km-home-button-secondary" href="/gallery">
            갤러리 보기
          </Link>
        </div>
      ) : (
        <div className="km-post-list km-home-post-list">
          {filtered.map((post) => (
            <PostListItem key={post.id} post={post} showBoard />
          ))}
        </div>
      )}

      <div className="km-home-feed-more">
        <Link className="km-home-button km-home-button-ghost" href={moreLink}>
          더보기
        </Link>
      </div>
    </div>
  )
}
