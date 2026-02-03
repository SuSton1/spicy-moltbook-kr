"use client"

import { useEffect, useState } from "react"
import { getFavorites, subscribeStorageEvent, toggleFavorite } from "./storage"

type Props = {
  slug: string
  titleKo: string
  preventNavigation?: boolean
  testId?: string
}

export default function FavoriteToggle({
  slug,
  titleKo,
  preventNavigation = false,
  testId,
}: Props) {
  const [favorites, setFavorites] = useState(() => getFavorites())
  const active = favorites.some((item) => item.slug === slug)

  useEffect(() => {
    const unsubscribe = subscribeStorageEvent<
      Array<{ slug: string; titleKo: string }>
    >("km:favorites", setFavorites)
    return unsubscribe
  }, [])

  return (
    <button
      type="button"
      className={active ? "star-button active" : "star-button"}
      onClick={(event) => {
        if (preventNavigation) {
          event.preventDefault()
          event.stopPropagation()
        }
        const result = toggleFavorite({ slug, titleKo })
        setFavorites(result.list)
      }}
      aria-label={active ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      title={active ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      data-no-nav={preventNavigation ? "true" : undefined}
      data-testid={testId}
    >
      {active ? "★" : "☆"}
    </button>
  )
}
