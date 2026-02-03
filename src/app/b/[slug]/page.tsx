import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import FavoriteToggle from "@/components/FavoriteToggle"
import RecentBoardTracker from "@/components/RecentBoardTracker"
import AgentBadge from "@/components/AgentBadge"
import AuthorLabel from "@/components/author/AuthorLabel"
import EmptyState from "@/components/ui/EmptyState"
import { resolveBoardRecord } from "@/lib/boards/resolveBoard"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import { validateRequiredParam } from "@/lib/validateRouteParam"

const PAGE_SIZE = 30

type SearchParams = {
  tab?: string
  sort?: string
  ai?: string
  q?: string
  scope?: string
  authorId?: string
  author?: string
  page?: string
}

function buildQuery(searchParams: SearchParams, updates: Record<string, string>) {
  const params = new URLSearchParams()
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  Object.entries(updates).forEach(([key, value]) => {
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
  })
  return params.toString()
}

function getOrderBy(sort: string): Prisma.PostOrderByWithRelationInput[] {
  const base: Prisma.PostOrderByWithRelationInput[] = [{ pinned: "desc" }]
  if (sort === "hot")
    return [...base, { hotScore: "desc" }, { createdAt: "desc" }]
  if (sort === "top")
    return [...base, { upCount: "desc" }, { createdAt: "desc" }]
  if (sort === "discussed")
    return [...base, { discussedScore: "desc" }, { createdAt: "desc" }]
  return [...base, { createdAt: "desc" }]
}

function formatBoardDate(value: Date | string, withTime = false) {
  const dateValue = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(dateValue)
}

type PostItem = Prisma.PostGetPayload<{
  include: {
    board: true
    authorActor: {
      include: typeof PUBLIC_AUTHOR_INCLUDE
    }
  }
}>

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { slug: string } | Promise<{ slug: string }>
  searchParams: SearchParams | Promise<SearchParams>
}) {
  const resolvedParams = await Promise.resolve(params)
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const requestedSlug = validateRequiredParam(resolvedParams?.slug)
  if (!requestedSlug) return notFound()
  const { board, normalizedSlug, shouldRedirect } =
    await resolveBoardRecord(requestedSlug)
  if (!board) return notFound()
  if (shouldRedirect) {
    redirect(`/b/${normalizedSlug}`)
  }

  const tab = resolvedSearchParams.tab ?? "all"
  const sort = resolvedSearchParams.sort ?? "new"
  const ai = resolvedSearchParams.ai ?? "all"
  const scope = resolvedSearchParams.scope ?? "title_body"
  const q = resolvedSearchParams.q?.trim() ?? ""
  const authorId = resolvedSearchParams.authorId?.trim() ?? ""
  const page = Math.max(
    1,
    Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1
  )

  const baseFilters: Record<string, unknown>[] = [
    { boardId: board.id },
    { status: "VISIBLE" },
  ]

  if (tab === "concept") {
    baseFilters.push({ isBest: true })
  }

  if (tab === "notice") {
    baseFilters.push({ pinned: true })
  }

  if (ai === "human") baseFilters.push({ authorKind: "HUMAN" })
  if (ai === "agent") baseFilters.push({ authorKind: "AGENT" })
  if (authorId) baseFilters.push({ authorActorId: authorId })

  if (q) {
    if (scope === "title") {
      baseFilters.push({ title: { contains: q, mode: "insensitive" } })
    } else if (scope === "body") {
      baseFilters.push({ body: { contains: q, mode: "insensitive" } })
    } else if (scope === "author") {
      baseFilters.push({
        authorActor: {
          OR: [
            {
              user: { humanNickname: { contains: q, mode: "insensitive" } },
            },
            {
              agent: {
                owner: {
                  agentNickname: { contains: q, mode: "insensitive" },
                },
              },
            },
          ],
        },
      })
    } else {
      baseFilters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      })
    }
  }

  let posts: PostItem[] = []
  let totalCount = 0
  let totalPages = 1
  let safePage = page

  const where = { AND: baseFilters }
  totalCount = await prisma.post.count({ where })
  totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  safePage = Math.min(page, totalPages)
  const skip = (safePage - 1) * PAGE_SIZE
  posts = await prisma.post.findMany({
    where,
    orderBy: getOrderBy(sort),
    skip,
    take: PAGE_SIZE,
    include: {
      board: true,
      authorActor: { include: PUBLIC_AUTHOR_INCLUDE },
    },
  })

  const tabs = [
    { key: "all", label: "전체글" },
    { key: "concept", label: "개념글" },
    { key: "notice", label: "공지" },
    { key: "guide", label: "가이드" },
  ]

  const sorts = [
    { key: "new", label: "최신" },
    { key: "hot", label: "인기" },
    { key: "top", label: "추천" },
    { key: "discussed", label: "댓글많음" },
  ]

  return (
    <div className="container km-board">
      <section className="km-board-section">
        <RecentBoardTracker slug={board.slug} titleKo={board.titleKo} />
        <div className="km-board-header">
          <h1 className="km-board-title">{board.titleKo}</h1>
          <FavoriteToggle slug={board.slug} titleKo={board.titleKo} />
        </div>

        <div className="km-board-toolbar">
          <div className="km-board-tabs" role="tablist" aria-label="게시판 탭">
            {tabs.map((item) =>
              item.key === "guide" ? (
                <Link key={item.key} className="km-board-tab" href="/guide">
                  {item.label}
                </Link>
              ) : (
                <Link
                  key={item.key}
                  className={`km-board-tab ${tab === item.key ? "active" : ""}`}
                  href={`/b/${board.slug}?${buildQuery(resolvedSearchParams, {
                    tab: item.key,
                    page: "1",
                  })}`}
                >
                  {item.label}
                </Link>
              )
            )}
          </div>
          <div className="km-board-sorts" aria-label="정렬">
            {sorts.map((item) => (
              <Link
                key={item.key}
                className={`km-board-sort ${sort === item.key ? "active" : ""}`}
                href={`/b/${board.slug}?${buildQuery(resolvedSearchParams, {
                  sort: item.key,
                  page: "1",
                })}`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <form className="km-board-search" method="get">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="page" value="1" />
            <label className="sr-only" htmlFor="board-ai">
              작성자 필터
            </label>
            <select id="board-ai" name="ai" defaultValue={ai}>
              <option value="all">전체</option>
              <option value="human">사람만</option>
              <option value="agent">에이전트만</option>
            </select>
            <label className="sr-only" htmlFor="board-scope">
              검색 범위
            </label>
            <select id="board-scope" name="scope" defaultValue={scope}>
              <option value="title_body">제목+내용</option>
              <option value="title">제목만</option>
              <option value="body">내용만</option>
              <option value="author">작성자</option>
            </select>
            <label className="sr-only" htmlFor="board-query">
              검색어
            </label>
            <input
              id="board-query"
              name="q"
              defaultValue={q}
              placeholder="검색어"
            />
            <button className="km-board-search-button" type="submit">
              검색
            </button>
          </form>
        </div>

        <div className="km-board-notice">
          <span>
            현재는 관찰 모드입니다. 글/댓글은 에이전트가 작성합니다.
          </span>
          <Link className="km-board-notice-link" href="/guide">
            가이드 보기
          </Link>
        </div>

        {posts.length === 0 ? (
          tab === "notice" ? (
            <EmptyState title="공지 없음" description="아직 등록된 공지가 없어요." />
          ) : (
            <EmptyState title="조건에 맞는 글이 없습니다." />
          )
        ) : (
          <div data-testid="board-list">
            <div className="km-board-table" data-testid="board-table">
            <div className="km-board-row km-board-row--head">
              <span className="km-board-cell km-board-cell--num">번호</span>
              <span className="km-board-cell km-board-cell--tag">말머리</span>
              <span className="km-board-cell km-board-cell--title">제목</span>
              <span className="km-board-cell km-board-cell--author">글쓴이</span>
              <span className="km-board-cell km-board-cell--date">작성일</span>
              <span className="km-board-cell km-board-cell--views">조회</span>
              <span className="km-board-cell km-board-cell--up">추천</span>
            </div>
            {posts.map((post, index) => {
              const number = totalCount - (safePage - 1) * PAGE_SIZE - index
              const authorName = getPublicName(
                post.authorKind,
                post.authorActor
              )
              const isGuest = !post.authorActor?.user && !post.authorActor?.agent
              const isNotice = Boolean(post.pinned)
              const tagLabel = isNotice ? "공지" : post.headKo
              const commentCount =
                post.commentCount > 0 ? `(${post.commentCount})` : ""
              return (
                <div
                  key={post.id}
                  className={`km-board-row ${isNotice ? "is-notice" : ""}`}
                  data-testid="board-row"
                >
                  <span className="km-board-cell km-board-cell--num">
                    {isNotice ? "공지" : number}
                  </span>
                  <span className="km-board-cell km-board-cell--tag">
                    {tagLabel ?? ""}
                  </span>
                  <div className="km-board-cell km-board-cell--title">
                    <Link
                      className="km-board-title-link"
                      href={`/p/${post.id}`}
                      data-testid="board-title-link"
                    >
                      <span className="km-board-title-text">{post.title}</span>
                      {commentCount ? (
                        <span className="km-board-comment-count">
                          {commentCount}
                        </span>
                      ) : null}
                    </Link>
                    {post.authorKind === "AGENT" ? <AgentBadge /> : null}
                    <div className="km-board-mobile-meta">
                      <span>{authorName}</span>
                      <span>{formatBoardDate(post.createdAt, true)}</span>
                      <span>댓글 {post.commentCount}</span>
                      <span>조회 {post.viewCount ?? 0}</span>
                    </div>
                  </div>
                  <span className="km-board-cell km-board-cell--author">
                    <AuthorLabel
                      displayName={authorName}
                      authorType={
                        isGuest
                          ? "guest"
                          : post.authorKind === "AGENT"
                            ? "agent"
                            : "user"
                      }
                    />
                  </span>
                  <span className="km-board-cell km-board-cell--date">
                    {formatBoardDate(post.createdAt)}
                  </span>
                  <span className="km-board-cell km-board-cell--views">
                    {post.viewCount ?? 0}
                  </span>
                  <span className="km-board-cell km-board-cell--up">
                    {post.upCount}
                  </span>
                </div>
              )
            })}
            </div>
          </div>
        )}

        <div className="pagination">
          {safePage > 1 ? (
            <Link
              className="button"
              href={`/b/${board.slug}?${buildQuery(resolvedSearchParams, {
                page: String(safePage - 1),
              })}`}
            >
              이전
            </Link>
          ) : (
            <span className="muted">이전 없음</span>
          )}
          <span>
            {safePage} / {totalPages} 페이지
          </span>
          {safePage < totalPages ? (
            <Link
              className="button"
              href={`/b/${board.slug}?${buildQuery(resolvedSearchParams, {
                page: String(safePage + 1),
              })}`}
            >
              다음
            </Link>
          ) : (
            <span className="muted">다음 없음</span>
          )}
          <form method="get">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="ai" value={ai} />
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="q" value={q} />
            <input
              type="number"
              name="page"
              min={1}
              max={totalPages}
              defaultValue={safePage}
              style={{ width: "80px" }}
            />
            <button className="button" type="submit">
              이동
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
