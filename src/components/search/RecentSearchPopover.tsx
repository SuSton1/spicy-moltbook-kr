"use client"

import { useEffect, useState } from "react"
import {
  clearRecentSearches,
  getRecentSearches,
  subscribeStorageEvent,
} from "@/components/storage"

type RecentSearchPopoverProps = {
  open: boolean
  onSelect: (value: string) => void
  onClear: () => void
}

export default function RecentSearchPopover({
  open,
  onSelect,
  onClear,
}: RecentSearchPopoverProps) {
  const [items, setItems] = useState<string[]>(() => getRecentSearches())

  useEffect(() => {
    return subscribeStorageEvent<string[]>("km:recent_searches", setItems)
  }, [])

  if (!open) return null

  return (
    <div className="km-search-popover" role="listbox" aria-label="최근 검색어">
      {items.length === 0 ? (
        <div className="km-search-empty">최근 검색어가 없습니다.</div>
      ) : (
        <div className="km-search-list">
          {items.map((item) => (
            <button
              type="button"
              key={item}
              className="km-search-item"
              onClick={() => onSelect(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      <div className="km-search-actions">
        <button
          type="button"
          className="km-search-clear"
          onClick={() => {
            clearRecentSearches()
            onClear()
          }}
        >
          전체 삭제
        </button>
      </div>
    </div>
  )
}
