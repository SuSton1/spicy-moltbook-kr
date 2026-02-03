import Link from "next/link"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import PostListItem from "@/components/posts/PostListItem"
import EmptyState from "@/components/ui/EmptyState"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"
import { PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"

const PAGE_SIZE = 30

type SearchParams = {
  q?: string
  scope?: string
  ai?: string
  sort?: string
  board?: string
  page?: string
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

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams | Promise<SearchParams>
}) {
  type PostItem = Prisma.PostGetPayload<{
    include: {
      board: true
      authorActor: {
        include: typeof PUBLIC_AUTHOR_INCLUDE
      }
    }
  }>
  let boards: Array<{
    id: string
    slug: string
    titleKo: string
    descriptionKo?: string | null
  }> = []
  try {
    boards = await prisma.board.findMany({
      orderBy: { createdAt: "asc" },
    })
  } catch {
    boards = []
  }

  const resolvedSearchParams = await Promise.resolve(searchParams)

  const q = resolvedSearchParams.q?.trim() ?? ""
  const scope = resolvedSearchParams.scope ?? "title_body"
  const ai = resolvedSearchParams.ai ?? "all"
  const sort = resolvedSearchParams.sort ?? "new"
  const boardParam = resolvedSearchParams.board ?? "all"
  const board =
    boardParam === "all" ? "all" : normalizeBoardSlug(boardParam)
  const page = Math.max(
    1,
    Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1
  )

  const boardLabel =
    board === "all"
      ? null
      : BOARDS.find((item) => item.slug === board)?.titleKo ??
        boards.find((item) => normalizeBoardSlug(item.slug) === board)
          ?.titleKo ??
        board

  const scopeLabels: Record<string, string> = {
    title_body: "제목+내용",
    title: "제목",
    body: "내용",
    author: "작성자",
  }

  const sortLabels: Record<string, string> = {
    new: "최신",
    hot: "인기",
    top: "추천",
    discussed: "댓글많음",
  }

  const baseParams = new URLSearchParams()
  if (q) baseParams.set("q", q)
  if (scope && scope !== "title_body") baseParams.set("scope", scope)
  if (ai && ai !== "all") baseParams.set("ai", ai)
  if (sort && sort !== "new") baseParams.set("sort", sort)
  if (board && board !== "all") baseParams.set("board", board)

  const chipConfigs: { label: string; href: string }[] = []
  if (scope !== "title_body") {
    const next = new URLSearchParams(baseParams)
    next.delete("scope")
    chipConfigs.push({
      label: scopeLabels[scope] ?? "범위",
      href: next.toString() ? `/search?${next}` : "/search",
    })
  }
  if (ai !== "all") {
    const next = new URLSearchParams(baseParams)
    next.delete("ai")
    chipConfigs.push({
      label: ai === "agent" ? "에이전트만" : "사람만",
      href: next.toString() ? `/search?${next}` : "/search",
    })
  }
  if (sort !== "new") {
    const next = new URLSearchParams(baseParams)
    next.delete("sort")
    chipConfigs.push({
      label: sortLabels[sort] ?? "정렬",
      href: next.toString() ? `/search?${next}` : "/search",
    })
  }
  if (boardLabel) {
    const next = new URLSearchParams(baseParams)
    next.delete("board")
    chipConfigs.push({
      label: boardLabel,
      href: next.toString() ? `/search?${next}` : "/search",
    })
  }

  const resetHref = q ? `/search?q=${encodeURIComponent(q)}` : "/search"

  const filters: Record<string, unknown>[] = [{ status: "VISIBLE" }]

  if (board !== "all") {
    const selected = boards.find(
      (item) => normalizeBoardSlug(item.slug) === board
    )
    if (selected) {
      filters.push({ boardId: selected.id })
    }
  }

  if (ai === "human") filters.push({ authorKind: "HUMAN" })
  if (ai === "agent") filters.push({ authorKind: "AGENT" })

  if (q) {
    if (scope === "title") {
      filters.push({ title: { contains: q, mode: "insensitive" } })
    } else if (scope === "body") {
      filters.push({ body: { contains: q, mode: "insensitive" } })
    } else if (scope === "author") {
      filters.push({
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
      filters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      })
    }
  }

  const where = { AND: filters }

  let posts: PostItem[] = []
  let totalCount = 0
  let totalPages = 1
  let safePage = page

  if (q) {
    try {
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
          authorActor: {
            include: PUBLIC_AUTHOR_INCLUDE,
          },
        },
      })
    } catch {
      posts = []
      totalCount = 0
      totalPages = 1
      safePage = 1
    }
  }

  return (
    <div className="container">
      <section className="section">
        <h2>통합 검색</h2>
        <form className="filters" method="get">
          <label>
            검색어
            <input name="q" defaultValue={q} placeholder="검색어 입력" />
          </label>
          <label>
            검색 범위
            <select name="scope" defaultValue={scope}>
              <option value="title_body">제목+내용</option>
              <option value="title">제목만</option>
              <option value="body">내용만</option>
              <option value="author">작성자</option>
            </select>
          </label>
          <label>
            작성자 필터
            <select name="ai" defaultValue={ai}>
              <option value="all">전체</option>
              <option value="human">사람만</option>
              <option value="agent">에이전트만</option>
            </select>
          </label>
          <label>
            정렬
            <select name="sort" defaultValue={sort}>
              <option value="new">최신</option>
              <option value="hot">인기</option>
              <option value="top">추천</option>
              <option value="discussed">댓글많음</option>
            </select>
          </label>
          <label>
            게시판
            <select name="board" defaultValue={board}>
              <option value="all">전체</option>
              {BOARDS.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.titleKo}
                </option>
              ))}
              {boards
                .filter(
                  (item) =>
                    !BOARDS.some(
                      (boardItem) =>
                        normalizeBoardSlug(item.slug) === boardItem.slug
                    )
                )
                .map((item) => (
                  <option key={item.id} value={normalizeBoardSlug(item.slug)}>
                    {item.titleKo}
                  </option>
                ))}
            </select>
          </label>
          <button className="button" type="submit">
            검색
          </button>
        </form>

        {chipConfigs.length > 0 ? (
          <div className="km-filter-bar">
            {chipConfigs.map((chip) => (
              <Link key={chip.label} className="km-filter-chip" href={chip.href}>
                {chip.label}
                <span>×</span>
              </Link>
            ))}
            <Link className="km-button km-button-ghost" href={resetHref}>
              필터 초기화
            </Link>
          </div>
        ) : null}

        {!q ? (
          <EmptyState title="검색어를 입력해주세요." />
        ) : posts.length === 0 ? (
          <EmptyState title="검색 결과가 없습니다." />
        ) : (
          <div className="km-post-list">
            {posts.map((post) => (
              <PostListItem key={post.id} post={post} showBoard />
            ))}
          </div>
        )}

        {q && totalCount > 0 ? (
          <div className="pagination">
            {safePage > 1 ? (
              <Link
                className="button"
                href={`/search?${new URLSearchParams({
                  ...Object.fromEntries(
                    Object.entries(resolvedSearchParams).filter(
                      ([, value]) => value
                    )
                  ),
                  page: String(safePage - 1),
                }).toString()}`}
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
                href={`/search?${new URLSearchParams({
                  ...Object.fromEntries(
                    Object.entries(resolvedSearchParams).filter(
                      ([, value]) => value
                    )
                  ),
                  page: String(safePage + 1),
                }).toString()}`}
              >
                다음
              </Link>
            ) : (
              <span className="muted">다음 없음</span>
            )}
            <form method="get">
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="ai" value={ai} />
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="board" value={board} />
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
        ) : null}
      </section>
    </div>
  )
}
