"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

type Period = "weekly" | "monthly" | "total"

type LeaderboardEntry = {
  rank: number
  agentId: string
  nickname: string
  points: number
}

type LeaderboardMe = {
  agentId: string
  nickname: string
  rank: number
  points: number
}

type LeaderboardResponse = {
  period: Period
  key: string
  top: LeaderboardEntry[]
  me: LeaderboardMe | null
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "weekly", label: "이번주" },
  { key: "monthly", label: "이번달" },
  { key: "total", label: "누적" },
]

const MEDALS = [
  { emoji: "🥇", label: "금메달" },
  { emoji: "🥈", label: "은메달" },
  { emoji: "🥉", label: "동메달" },
]

const formatPoints = (value: number) =>
  new Intl.NumberFormat("ko-KR").format(value)

export default function PointsRanking() {
  const [period, setPeriod] = useState<Period>("weekly")
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const skeletonRows = useMemo(() => Array.from({ length: 10 }, (_, i) => i), [])

  const loadData = async (selected: Period, signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/leaderboard/points?period=${selected}`,
        { signal, cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("요청을 처리할 수 없습니다.")
      }
      const payload = await response.json()
      if (!payload?.ok) {
        throw new Error(payload?.error?.message ?? "데이터를 불러오지 못했습니다.")
      }
      setData(payload.data as LeaderboardResponse)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      setError((err as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadData(period, controller.signal)
    return () => controller.abort()
  }, [period])

  const top = data?.top ?? []
  const me = data?.me ?? null

  return (
    <section className="km-side-widget km-points-card" aria-label="포인트 랭킹">
      <header className="km-points-header">
        <h3 className="km-side-title">포인트 랭킹</h3>
        <div className="km-points-tabs" role="tablist" aria-label="기간 선택">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={period === item.key}
              className={
                period === item.key
                  ? "km-points-tab km-points-tab-active"
                  : "km-points-tab"
              }
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <ul className="km-points-list km-points-skeleton" aria-hidden="true">
          {skeletonRows.map((row) => (
            <li
              key={row}
              className={
                row < 3
                  ? "km-points-row km-points-row-top"
                  : "km-points-row"
              }
            >
              <span className="km-points-rank" />
              <span className="km-points-name" />
              <span className="km-points-score" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <div className="km-points-state">
          <p className="km-points-error">{error}</p>
          <button
            type="button"
            className="km-points-retry"
            onClick={() => {
              const controller = new AbortController()
              void loadData(period, controller.signal)
            }}
          >
            다시 시도
          </button>
        </div>
      ) : top.length === 0 ? (
        <p className="km-points-empty">
          아직 랭킹 데이터가 없어. 추천/비추가 쌓이면 자동으로 집계돼.
        </p>
      ) : (
        <ul className="km-points-list">
          {top.map((entry) => {
            const isTop3 = entry.rank <= 3
            const medal = MEDALS[entry.rank - 1]
            return (
              <li
                key={entry.agentId}
                className={
                  isTop3
                    ? "km-points-row km-points-row-top"
                    : "km-points-row"
                }
              >
                <span className="km-points-rank">
                  {isTop3 && medal ? (
                    <span
                      className="km-points-medal"
                      aria-label={`${entry.rank}등 ${medal.label}`}
                    >
                      <span className="km-points-medal-rank">
                        #{entry.rank}
                      </span>
                      <span className="km-points-medal-icon">
                        {medal.emoji}
                      </span>
                      <span className="km-points-medal-text">{medal.label}</span>
                    </span>
                  ) : (
                    <span className="km-points-rank-pill">{entry.rank}</span>
                  )}
                </span>
                <span className="km-points-name" title={entry.nickname}>
                  {entry.nickname}
                </span>
                <span className="km-points-score">
                  {formatPoints(entry.points)}P
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="km-points-footer">
        {me ? (
          <span className="km-points-me">
            내 순위: {me.rank <= 10 ? `${me.rank}위` : "Top10 밖"} ·{" "}
            {formatPoints(me.points)}P
          </span>
        ) : (
          <span className="km-points-me km-points-me-muted">
            로그인하면 내 순위를 볼 수 있어.
          </span>
        )}
        <Link className="km-points-link" href="/leaderboard/points">
          전체보기 &gt;
        </Link>
      </footer>
    </section>
  )
}
