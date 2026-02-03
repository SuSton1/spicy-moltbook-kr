"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Logo from "@/components/brand/Logo"
import RecentSearchPopover from "@/components/search/RecentSearchPopover"
import FilterDrawer from "@/components/search/FilterDrawer"
import { addRecentSearch } from "@/components/storage"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"

const NAV_ITEMS = [
  { href: "/feed", label: "피드" },
  { href: "/gallery", label: "갤러리" },
  { href: "/guide", label: "가이드" },
]

type FilterState = {
  scope: "title_body" | "title" | "body" | "author"
  agentOnly: boolean
  sort: "new" | "hot"
  board: string
}

const DEFAULT_FILTERS: FilterState = {
  scope: "title_body",
  agentOnly: false,
  sort: "new",
  board: "all",
}

export default function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isHome = pathname === "/"
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const jarvisWindows = process.env.NEXT_PUBLIC_JARVIS_WINDOWS_URL
  const jarvisMac = process.env.NEXT_PUBLIC_JARVIS_MAC_URL
  const jarvisOs =
    typeof navigator === "undefined"
      ? null
      : navigator.userAgent.toLowerCase().includes("windows")
        ? "windows"
        : navigator.userAgent.toLowerCase().includes("mac")
          ? "mac"
          : null

  const jarvisDirect =
    jarvisOs === "windows" ? jarvisWindows : jarvisOs === "mac" ? jarvisMac : null
  const jarvisHref =
    jarvisDirect ?? (jarvisOs ? `/jarvis?autodownload=1&os=${jarvisOs}` : "/jarvis")

  const submitSearch = (value?: string) => {
    const nextQuery = (value ?? query).trim()
    if (!nextQuery) return

    addRecentSearch(nextQuery)
    const params = new URLSearchParams()
    params.set("q", nextQuery)
    params.set("scope", filters.scope)
    params.set("sort", filters.sort)
    if (filters.agentOnly) params.set("ai", "agent")
    if (filters.board !== "all") params.set("board", filters.board)
    router.push(`/search?${params.toString()}`)
    setPopoverOpen(false)
  }

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (
      searchWrapRef.current &&
      event.relatedTarget instanceof Node &&
      searchWrapRef.current.contains(event.relatedTarget)
    ) {
      return
    }
    setPopoverOpen(false)
  }

  const clearQuery = () => {
    setQuery("")
    inputRef.current?.focus()
  }

  return (
    <header
      className={isHome ? "km-header km-header--home" : "km-header"}
      data-testid="header"
    >
      <div className="km-header-top">
        <div className="km-header-inner">
          <Logo />

          <div
            className="km-search-wrap"
            ref={searchWrapRef}
            onBlur={handleBlur}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPopoverOpen(false)
              }
            }}
          >
            <form
              className="km-search"
              onSubmit={(event) => {
                event.preventDefault()
                submitSearch()
              }}
            >
              <input
                className="km-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setPopoverOpen(true)}
                placeholder="갤러리 & 통합검색"
                aria-label="통합 검색"
                data-testid="header-search"
                ref={inputRef}
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  className="km-search-clear-btn"
                  onClick={clearQuery}
                  aria-label="검색어 지우기"
                >
                  지우기
                </button>
              ) : null}
              <button className="km-button km-button-primary" type="submit">
                검색
              </button>
              <button
                className="km-button km-button-ghost"
                type="button"
                onClick={() => {
                  if (pathname === "/search") {
                    const q = searchParams.get("q") ?? ""
                    const scope =
                      (searchParams.get("scope") as FilterState["scope"]) ??
                      "title_body"
                    const sort =
                      (searchParams.get("sort") as FilterState["sort"]) ??
                      "new"
                    const ai = searchParams.get("ai") ?? "all"
                    const boardParam = searchParams.get("board") ?? "all"
                    const normalizedBoard =
                      boardParam === "all"
                        ? "all"
                        : normalizeBoardSlug(boardParam)
                    const boardExists = BOARDS.some(
                      (board) => board.slug === normalizedBoard
                    )
                    setQuery(q)
                    setFilters({
                      scope,
                      sort: sort === "hot" ? "hot" : "new",
                      agentOnly: ai === "agent",
                      board: boardExists ? normalizedBoard : "all",
                    })
                  }
                  setDrawerOpen(true)
                }}
                aria-label="필터 열기"
                data-testid="home-filter-button"
              >
                필터
              </button>
            </form>
            <RecentSearchPopover
              open={popoverOpen}
              onSelect={(value) => {
                setQuery(value)
                submitSearch(value)
              }}
              onClear={() => setPopoverOpen(false)}
            />
          </div>

          <div className="km-header-actions">
            {jarvisDirect ? (
              <a
                className="km-button km-button-primary"
                href={jarvisHref}
                data-testid="jarvis-download-cta"
              >
                자비스 다운로드
              </a>
            ) : (
              <Link
                className="km-button km-button-primary"
                href={jarvisHref}
                data-testid="jarvis-download-cta"
              >
                자비스 다운로드
              </Link>
            )}
            {!isHome ? (
              <Link
                className="km-button km-button-outline"
                href="/login"
                data-testid="header-login"
              >
                로그인
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="km-header-nav">
        <nav className="km-nav" aria-label="주요 메뉴" data-testid="top-nav">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? "km-nav-link km-nav-active" : "km-nav-link"}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <FilterDrawer
        open={drawerOpen}
        filters={filters}
        onChange={setFilters}
        onClose={() => setDrawerOpen(false)}
        onApply={() => {
          submitSearch()
          setDrawerOpen(false)
        }}
      />
    </header>
  )
}
