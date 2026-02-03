import Link from "next/link"
import FavoriteToggle from "@/components/FavoriteToggle"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"

type BoardItem = {
  id: string
  slug: string
  titleKo: string
  descriptionKo?: string | null
  postsToday?: number | null
  totalPosts?: number | null
}

type BoardsIndexProps = {
  boards: BoardItem[]
  title?: string
}

export default function BoardsIndex({
  boards,
  title = "갤러리 목록",
}: BoardsIndexProps) {
  const priority = BOARDS.map((board) => board.slug)
  const sortedBoards = [...boards].sort((a, b) => {
    const aSlug = normalizeBoardSlug(a.slug)
    const bSlug = normalizeBoardSlug(b.slug)
    const aIndex = priority.indexOf(aSlug)
    const bIndex = priority.indexOf(bSlug)
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    }
    return a.titleKo.localeCompare(b.titleKo)
  })
  const hasBoards = sortedBoards.length > 0
  const writeSlug = hasBoards ? normalizeBoardSlug(sortedBoards[0].slug) : null
  const writeHref = writeSlug ? `/b/${writeSlug}/new` : null
  const defaultDescription = "지금 바로 이야기 나눌 수 있는 보드야."

  return (
    <div className="container km-gallery">
      <section className="section">
        <div className="km-gallery-title">
          <h1>{title}</h1>
          <p className="km-gallery-subtitle">
            관심 보드를 골라 바로 들어가봐.
          </p>
          <div className="km-gallery-actions">
            <div className="km-tabs" role="tablist" aria-label="갤러리 메뉴">
              <span className="km-tab km-tab-active" aria-current="page">
                둘러보기
              </span>
              {writeHref ? (
                <Link className="km-tab" href={writeHref}>
                  글쓰기
                </Link>
              ) : (
                <span className="km-tab" aria-disabled="true">
                  글쓰기
                </span>
              )}
            </div>
          </div>
        </div>
        {boards.length === 0 ? (
          <div className="empty">
            <p>등록된 게시판이 없습니다.</p>
          </div>
        ) : (
          <div className="km-gallery-grid" data-testid="gallery-list">
            {sortedBoards.map((board) => {
              const slug = normalizeBoardSlug(board.slug)
              const description =
                board.descriptionKo?.trim() || defaultDescription
              const hasStats =
                typeof board.postsToday === "number" ||
                typeof board.totalPosts === "number"
              return (
                <Link
                  key={board.id}
                  className="km-gallery-card"
                  href={`/b/${slug}`}
                  data-testid="gallery-board-card"
                  aria-label={`${board.titleKo} 보드로 이동`}
                >
                  <div className="km-gallery-card-header">
                    <h3 className="km-gallery-card-title">{board.titleKo}</h3>
                  </div>
                  <p className="km-gallery-card-desc">{description}</p>
                  {hasStats ? (
                    <div className="km-gallery-card-stats">
                      {typeof board.postsToday === "number" ? (
                        <span>오늘 {board.postsToday}개</span>
                      ) : null}
                      {typeof board.totalPosts === "number" ? (
                        <span>누적 {board.totalPosts}개</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="km-gallery-card-actions">
                    <span className="km-gallery-enter">들어가기</span>
                    <FavoriteToggle
                      slug={slug}
                      titleKo={board.titleKo}
                      preventNavigation
                      testId="gallery-board-star"
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
