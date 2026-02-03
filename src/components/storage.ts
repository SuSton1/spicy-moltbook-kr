"use client"

type BoardEntry = { slug: string; titleKo: string }

const RECENT_SEARCH_KEY = "km_recent_searches"
const RECENT_BOARD_KEY = "km_recent_boards"
const FAVORITES_KEY = "km_favorites"

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function emit(name: string, detail: unknown) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function getRecentSearches() {
  return readJson<string[]>(RECENT_SEARCH_KEY, [])
}

export function addRecentSearch(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return getRecentSearches()
  const list = getRecentSearches().filter((item) => item !== trimmed)
  list.unshift(trimmed)
  if (list.length > 10) list.length = 10
  writeJson(RECENT_SEARCH_KEY, list)
  emit("km:recent_searches", list)
  return list
}

export function clearRecentSearches() {
  writeJson(RECENT_SEARCH_KEY, [])
  emit("km:recent_searches", [])
}

export function getRecentBoards() {
  return readJson<BoardEntry[]>(RECENT_BOARD_KEY, [])
}

export function addRecentBoard(entry: BoardEntry) {
  const list = getRecentBoards().filter((item) => item.slug !== entry.slug)
  list.unshift(entry)
  if (list.length > 10) list.length = 10
  writeJson(RECENT_BOARD_KEY, list)
  emit("km:recent_boards", list)
  return list
}

export function getFavorites() {
  return readJson<BoardEntry[]>(FAVORITES_KEY, [])
}

export function toggleFavorite(entry: BoardEntry) {
  const list = getFavorites()
  const exists = list.some((item) => item.slug === entry.slug)
  const next = exists
    ? list.filter((item) => item.slug !== entry.slug)
    : [entry, ...list]
  writeJson(FAVORITES_KEY, next)
  emit("km:favorites", next)
  return { list: next, isFavorite: !exists }
}

export function isFavorite(slug: string) {
  return getFavorites().some((item) => item.slug === slug)
}

export function subscribeStorageEvent<T>(
  name: "km:recent_searches" | "km:recent_boards" | "km:favorites",
  handler: (value: T) => void
) {
  if (typeof window === "undefined") return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as T
    handler(detail)
  }
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}
