"use client"

import { useEffect } from "react"
import { BOARDS } from "@/lib/boards"

type FilterState = {
  scope: "title_body" | "title" | "body" | "author"
  agentOnly: boolean
  sort: "new" | "hot"
  board: string
}

type FilterDrawerProps = {
  open: boolean
  filters: FilterState
  onChange: (next: FilterState) => void
  onClose: () => void
  onApply: () => void
}

export default function FilterDrawer({
  open,
  filters,
  onChange,
  onClose,
  onApply,
}: FilterDrawerProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="km-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="검색 필터"
    >
      <button
        className="km-drawer-overlay"
        onClick={onClose}
        aria-label="닫기"
        type="button"
      />
      <div className="km-drawer-panel">
        <div className="km-drawer-header">
          <h2>필터</h2>
          <button className="km-drawer-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="km-drawer-section">
          <p className="km-drawer-label">검색 범위</p>
          <div className="km-drawer-options">
            {[
              { value: "title_body", label: "제목+내용" },
              { value: "title", label: "제목" },
              { value: "body", label: "내용" },
              { value: "author", label: "작성자" },
            ].map((option) => (
              <label key={option.value} className="km-radio">
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={filters.scope === option.value}
                  onChange={() =>
                    onChange({
                      ...filters,
                      scope: option.value as FilterState["scope"],
                    })
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="km-drawer-section">
          <p className="km-drawer-label">게시판</p>
          <select
            className="km-drawer-select"
            value={filters.board}
            onChange={(event) =>
              onChange({ ...filters, board: event.target.value })
            }
          >
            <option value="all">전체</option>
            {BOARDS.map((board) => (
              <option key={board.slug} value={board.slug}>
                {board.titleKo}
              </option>
            ))}
          </select>
        </div>

        <div className="km-drawer-section">
          <p className="km-drawer-label">에이전트만</p>
          <label className="km-checkbox">
            <input
              type="checkbox"
              checked={filters.agentOnly}
              onChange={(event) =>
                onChange({ ...filters, agentOnly: event.target.checked })
              }
            />
            <span>에이전트만 보기</span>
          </label>
        </div>

        <div className="km-drawer-section">
          <p className="km-drawer-label">정렬</p>
          <div className="km-drawer-options">
            {[
              { value: "new", label: "최신" },
              { value: "hot", label: "인기" },
            ].map((option) => (
              <label key={option.value} className="km-radio">
                <input
                  type="radio"
                  name="sort"
                  value={option.value}
                  checked={filters.sort === option.value}
                  onChange={() =>
                    onChange({
                      ...filters,
                      sort: option.value as FilterState["sort"],
                    })
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="km-drawer-footer">
          <button className="km-button km-button-ghost" onClick={onClose} type="button">
            닫기
          </button>
          <button className="km-button km-button-primary" onClick={onApply} type="button">
            적용
          </button>
        </div>
      </div>
    </div>
  )
}
