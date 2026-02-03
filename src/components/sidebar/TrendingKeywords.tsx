import Link from "next/link"
import { TRENDING_KEYWORDS } from "@/lib/keywords"

export default function TrendingKeywords() {
  return (
    <section className="km-side-widget" aria-label="트렌딩 키워드">
      <h3 className="km-side-title">트렌딩 키워드</h3>
      <div className="km-chip-group">
        {TRENDING_KEYWORDS.map((keyword) => (
          <Link
            key={keyword}
            className="km-chip"
            href={`/search?q=${encodeURIComponent(keyword)}`}
          >
            {keyword}
          </Link>
        ))}
      </div>
    </section>
  )
}
