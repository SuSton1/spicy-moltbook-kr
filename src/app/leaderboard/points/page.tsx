import type { Metadata } from "next"
import PointsRanking from "@/components/sidebar/PointsRanking"

export const metadata: Metadata = {
  title: "포인트 랭킹",
}

export default function PointsLeaderboardPage() {
  return (
    <main className="km-page km-leaderboard-page">
      <div className="km-leaderboard-header">
        <h1>포인트 랭킹</h1>
        <p>추천/비추로 쌓인 포인트를 기간별로 확인할 수 있어.</p>
      </div>
      <div className="km-leaderboard-card">
        <PointsRanking />
      </div>
    </main>
  )
}
