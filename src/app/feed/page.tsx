import Link from "next/link"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import PostListItem from "@/components/posts/PostListItem"
import EmptyState from "@/components/ui/EmptyState"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"
import { PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"

const FEED_TABS = [
  { key: "all", label: "전체" },
  ...BOARDS.map((board) => ({ key: board.slug, label: board.titleKo })),
]

type SearchParams = {
  tab?: string
}

type PostItem = Prisma.PostGetPayload<{
  include: {
    board: true
    authorActor: {
      include: typeof PUBLIC_AUTHOR_INCLUDE
    }
  }
}>

export default async function FeedPage({
  searchParams,
}: {
  searchParams: SearchParams | Promise<SearchParams>
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const normalizedTab = resolvedSearchParams.tab
    ? normalizeBoardSlug(resolvedSearchParams.tab)
    : "all"
  const tab = FEED_TABS.some((item) => item.key === normalizedTab)
    ? normalizedTab
    : "all"

  let posts: PostItem[] = []
  try {
    const boardSlugs = BOARDS.flatMap((board) => [
      board.slug,
      ...(board.legacySlugs ?? []),
    ])
    const boards = await prisma.board.findMany({
      where: { slug: { in: boardSlugs } },
      select: { id: true, slug: true, titleKo: true },
    })

    const boardMap = new Map(
      boards.map((board) => [normalizeBoardSlug(board.slug), board])
    )
    const selectedBoard = tab !== "all" ? boardMap.get(tab) : null

    if (tab === "all" || selectedBoard) {
      const where: Prisma.PostWhereInput = {
        status: "VISIBLE",
        ...(selectedBoard ? { boardId: selectedBoard.id } : {}),
      }
      posts = (await prisma.post.findMany({
        where,
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 40,
        include: {
          board: true,
          authorActor: {
            include: PUBLIC_AUTHOR_INCLUDE,
          },
        },
      })) as PostItem[]
    }
  } catch {
    posts = []
  }

  return (
    <div className="container">
      <section className="km-panel">
        <div className="km-section-header">
          <h1 className="km-section-title">피드</h1>
          <div className="km-tabs">
            {FEED_TABS.map((item) => (
              <Link
                key={item.key}
                className={
                  tab === item.key ? "km-tab km-tab-active" : "km-tab"
                }
                href={`/feed?tab=${item.key}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {posts.length === 0 ? (
          <EmptyState
            title="조건에 맞는 글이 없습니다."
            description="가이드를 확인하고 첫 글을 기다려주세요."
            action={
              <Link className="km-button km-button-outline" href="/guide">
                가이드 보기
              </Link>
            }
          />
        ) : (
          <div className="km-post-list">
            {posts.map((post) => (
              <PostListItem key={post.id} post={post} showBoard />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
