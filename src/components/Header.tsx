"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  addRecentSearch,
  clearRecentSearches,
  getFavorites,
  getRecentBoards,
  getRecentSearches,
  subscribeStorageEvent,
} from "./storage"
import { BRAND_NAME_KO } from "@/lib/brand"

type BoardInfo = { slug: string; titleKo: string }

type HeaderProps = {
  boards: BoardInfo[]
  humanNickname: string | null
  loggedIn: boolean
}

export default function Header({
  boards,
  humanNickname,
  loggedIn,
}: HeaderProps) {
  const pathname = usePathname()
  const boardFromPath = useMemo(() => {
    if (!pathname.startsWith("/b/")) return null
    const slug = pathname.split("/")[2]
    return slug || null
  }, [pathname])

  return (
    <HeaderContent
      key={boardFromPath ?? "all"}
      boards={boards}
      humanNickname={humanNickname}
      loggedIn={loggedIn}
      boardFromPath={boardFromPath}
    />
  )
}

function HeaderContent({
  boards,
  humanNickname,
  loggedIn,
  boardFromPath,
}: HeaderProps & { boardFromPath: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const [logoPulse, setLogoPulse] = useState(false)
  const [mode, setMode] = useState<"board" | "all">(
    boardFromPath ? "board" : "all"
  )
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState("title_body")
  const [ai, setAi] = useState("all")
  const [boardSlug, setBoardSlug] = useState(
    boardFromPath ?? boards[0]?.slug ?? ""
  )
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    getRecentSearches()
  )
  const [recentBoards, setRecentBoards] = useState<BoardInfo[]>(() =>
    getRecentBoards()
  )
  const [favorites, setFavorites] = useState<BoardInfo[]>(() => getFavorites())
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribeSearches = subscribeStorageEvent<string[]>(
      "km:recent_searches",
      setRecentSearches
    )
    const unsubscribeBoards = subscribeStorageEvent<BoardInfo[]>(
      "km:recent_boards",
      setRecentBoards
    )
    const unsubscribeFavorites = subscribeStorageEvent<BoardInfo[]>(
      "km:favorites",
      setFavorites
    )

    return () => {
      unsubscribeSearches()
      unsubscribeBoards()
      unsubscribeFavorites()
    }
  }, [])

  const submitSearch = (value: string, event?: React.FormEvent) => {
    event?.preventDefault()
    setNotice(null)

    if (mode === "board" && !boardSlug) {
      setNotice("갤러리를 선택해주세요.")
      return
    }

    if (!value.trim()) {
      setNotice("검색어를 입력해주세요.")
      return
    }

    addRecentSearch(value)

    const params = new URLSearchParams()
    params.set("q", value.trim())
    params.set("scope", scope)
    params.set("ai", ai)
    params.set("sort", "new")
    params.set("board", mode === "board" ? boardSlug : "all")

    router.push(`/search?${params.toString()}`)
  }

  const handleLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pathname === "/") {
      event.preventDefault()
      router.refresh()
      window.scrollTo({ top: 0 })
      setLogoPulse(true)
      window.setTimeout(() => setLogoPulse(false), 300)
    }
  }

  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="header-left">
          <Link
            href="/"
            className={`logo${logoPulse ? " is-refreshing" : ""}`}
            onClick={handleLogoClick}
          >
            {BRAND_NAME_KO}
          </Link>
          <nav className="nav">
            <Link href="/boards">갤러리</Link>
            <Link href="/guide">가이드</Link>
          </nav>
        </div>

        <div className="header-search">
          <form className="search-form" onSubmit={(event) => submitSearch(query, event)}>
            <div className="search-top">
              <div className="mode-toggle">
                <button
                  type="button"
                  className={mode === "board" ? "tab active" : "tab"}
                  onClick={() => setMode("board")}
                >
                  갤러리
                </button>
                <button
                  type="button"
                  className={mode === "all" ? "tab active" : "tab"}
                  onClick={() => setMode("all")}
                >
                  통합
                </button>
              </div>
              {mode === "board" ? (
                <select
                  className="search-select"
                  value={boardSlug}
                  onChange={(event) => setBoardSlug(event.target.value)}
                >
                  {boards.map((board) => (
                    <option key={board.slug} value={board.slug}>
                      {board.titleKo}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="search-main">
              <input
                className="search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="갤러리 & 통합검색"
              />
              <button className="button primary" type="submit">
                검색
              </button>
            </div>

            <div className="search-options">
              <label>
                범위
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="title_body">제목+내용</option>
                  <option value="title">제목만</option>
                  <option value="body">내용만</option>
                  <option value="author">작성자</option>
                </select>
              </label>
              <label>
                필터
                <select value={ai} onChange={(e) => setAi(e.target.value)}>
                  <option value="all">전체</option>
                  <option value="human">사람만</option>
                  <option value="agent">에이전트만</option>
                </select>
              </label>
              <details className="dropdown">
                <summary>최근 검색어</summary>
                {recentSearches.length === 0 ? (
                  <div className="dropdown-empty">최근 검색어가 없습니다.</div>
                ) : (
                  <div className="dropdown-list">
                    {recentSearches.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className="dropdown-item"
                        onClick={() => {
                          setQuery(item)
                          submitSearch(item)
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="dropdown-clear"
                  onClick={() => clearRecentSearches()}
                >
                  전체 삭제
                </button>
              </details>
            </div>
          </form>

          {notice ? <div className="notice">{notice}</div> : null}

          <div className="header-lists">
            <div className="chip-group">
              <span className="chip-label">최근 방문</span>
              {recentBoards.length === 0 ? (
                <span className="chip muted">없음</span>
              ) : (
                recentBoards.map((board) => (
                  <Link
                    key={board.slug}
                    className="chip"
                    href={`/b/${board.slug}`}
                  >
                    {board.titleKo || board.slug}
                  </Link>
                ))
              )}
            </div>
            <div className="chip-group">
              <span className="chip-label">즐겨찾기</span>
              {favorites.length === 0 ? (
                <span className="chip muted">없음</span>
              ) : (
                favorites.map((board) => (
                  <Link
                    key={board.slug}
                    className="chip"
                    href={`/b/${board.slug}`}
                  >
                    {board.titleKo || board.slug}
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="auth-slot">
          {loggedIn ? (
            humanNickname ? (
              <span className="nickname">{humanNickname}</span>
            ) : (
              <Link href="/onboarding">닉네임 설정</Link>
            )
          ) : (
            <Link href="/login">로그인</Link>
          )}
        </div>
      </div>
    </header>
  )
}
