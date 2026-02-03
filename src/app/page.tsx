import Link from "next/link"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import Shell from "@/components/layout/Shell"
import TodayFeed, { type FeedPost } from "@/components/posts/TodayFeed"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"
import { PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import {
  BRAND_ALIASES,
  BRAND_NAME_KO,
  BRAND_TAGLINE,
  BRAND_DOMAIN,
} from "@/lib/brand"

const FEATURED_DESCRIPTIONS: Record<string, string> = {
  singularity: "미래 기술 흐름을 가볍게 모아보는 보드",
  stocks: "시장 움직임과 매매 메모를 편하게 기록해",
  crypto: "코인 변동성과 심리를 빠르게 정리해",
}

type PostItem = Prisma.PostGetPayload<{
  include: {
    board: true
    authorActor: {
      include: typeof PUBLIC_AUTHOR_INCLUDE
    }
  }
}>

export default async function Home() {
  const baseUrl = process.env.NEXTAUTH_URL ?? `https://${BRAND_DOMAIN}`

  let featuredWithPosts: Array<{
    key: string
    titleKo: string
    slug: string
    href: string
    legacySlugs?: string[]
    board: { id: string; slug: string; titleKo: string } | null
    posts: PostItem[]
  }> = BOARDS.map((item) => ({ ...item, board: null, posts: [] }))
  let feedPosts: FeedPost[] = []

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

    featuredWithPosts = await Promise.all(
      BOARDS.map(async (item) => {
        const board = boardMap.get(item.slug)
        if (!board) {
          return { ...item, board: null, posts: [] as PostItem[] }
        }
        const posts = await prisma.post.findMany({
          where: { boardId: board.id, status: "VISIBLE" },
          orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
          take: 2,
          include: {
            board: true,
            authorActor: {
              include: PUBLIC_AUTHOR_INCLUDE,
            },
          },
        })
        return { ...item, board, posts }
      })
    )

    feedPosts = (await prisma.post.findMany({
      where: { status: "VISIBLE" },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 30,
      include: {
        board: true,
        authorActor: {
          include: PUBLIC_AUTHOR_INCLUDE,
        },
      },
    })).map((post) => ({
      ...post,
      createdAt: post.createdAt.toISOString(),
    })) as FeedPost[]
  } catch {
    featuredWithPosts = BOARDS.map((item) => ({ ...item, board: null, posts: [] }))
    feedPosts = []
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: BRAND_NAME_KO,
    alternateName: BRAND_ALIASES,
    url: baseUrl,
    description: BRAND_TAGLINE,
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
    publisher: {
      "@type": "Organization",
      name: BRAND_NAME_KO,
      alternateName: BRAND_ALIASES,
      contactPoint: {
        "@type": "ContactPoint",
        email: "blych123@gmail.com",
      },
    },
  }

  return (
    <div className="container km-home">
      <script
        type="application/ld+json"
        // JSON-LD is static (not user-generated) to avoid XSS.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Shell hideTrending hideSideLinks>
        <section className="km-home-card">
          <TodayFeed posts={feedPosts} />
        </section>

        <section className="km-home-section">
          <div className="km-home-section-header">
            <div>
              <h2 className="km-home-section-title">추천 보드</h2>
              <p className="km-home-section-desc">
                오늘 바로 들어갈 만한 보드만 모아뒀어.
              </p>
            </div>
            <Link className="km-home-link" href="/gallery">
              갤러리 전체
            </Link>
          </div>
          <div className="km-home-board-grid" data-testid="home-board-grid">
            {featuredWithPosts.map((item) => (
              <Link
                key={item.slug}
                href={`/b/${item.slug}`}
                className="km-home-board-card"
                data-testid="home-board-card"
              >
                <div className="km-home-board-header">
                  <span className="km-home-board-title">{item.titleKo}</span>
                  <p className="km-home-board-desc">
                    {FEATURED_DESCRIPTIONS[item.slug] ?? "지금 주목받는 갤러리"}
                  </p>
                </div>
                <div className="km-home-board-meta">새 글 보러가기</div>
              </Link>
            ))}
          </div>
        </section>
      </Shell>

    </div>
  )
}
