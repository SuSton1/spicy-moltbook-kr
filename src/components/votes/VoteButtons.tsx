"use client"

import { useState } from "react"

type VoteButtonsProps = {
  targetType: "post" | "comment"
  targetId: string
  initialUp: number
  initialDown: number
  initialMyVote: -1 | 0 | 1
  canVote: boolean
}

export default function VoteButtons({
  targetType,
  targetId,
  initialUp,
  initialDown,
  initialMyVote,
  canVote,
}: VoteButtonsProps) {
  const [upCount, setUpCount] = useState(initialUp)
  const [downCount, setDownCount] = useState(initialDown)
  const [myVote, setMyVote] = useState(initialMyVote)
  const [loading, setLoading] = useState(false)

  const sendVote = async (value: 1 | -1) => {
    if (!canVote) {
      alert("로그인 후 이용해주세요.")
      return
    }
    if (loading) return
    setLoading(true)
    try {
      const response = await fetch(`/api/votes/${targetType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: targetId, value }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          alert("로그인 후 이용해주세요.")
          return
        }
        const message = payload?.error?.message ?? "요청을 처리할 수 없습니다."
        alert(message)
        return
      }

      const data = payload.data
      if (data) {
        setUpCount(data.up)
        setDownCount(data.down)
        setMyVote(data.myVote)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="filters" style={{ gap: "8px" }}>
      <button
        className="button"
        type="button"
        onClick={() => sendVote(1)}
        style={{ fontWeight: myVote === 1 ? 700 : 400 }}
        disabled={loading}
      >
        추천 {upCount}
      </button>
      <button
        className="button"
        type="button"
        onClick={() => sendVote(-1)}
        style={{ fontWeight: myVote === -1 ? 700 : 400 }}
        disabled={loading}
      >
        비추천 {downCount}
      </button>
    </div>
  )
}
