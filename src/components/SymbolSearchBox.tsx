import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { preloadSymbolCache } from "../lib/symbolCache"
import { useSymbolsSearch } from "../hooks/useMarketData"

type SearchMarket = "ALL" | "KOSPI" | "KOSDAQ"

type SymbolSearchBoxProps = {
  title?: string
}

export const SymbolSearchBox = ({
  title = "종목 검색",
}: SymbolSearchBoxProps) => {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [searchMarket, setSearchMarket] = useState<SearchMarket>("ALL")
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const normalizedQuery = searchQuery.trim()
  const symbolSearch = useSymbolsSearch(searchMarket, normalizedQuery, 5, 1)

  const showDropdown = useMemo(
    () => isSearchFocused || normalizedQuery.length > 0,
    [isSearchFocused, normalizedQuery.length],
  )

  return (
    <div className="card">
      <div className="section-title">{title}</div>
      <div className="search-field" style={{ marginTop: "12px" }}>
        <input
          className="search-input"
          placeholder="종목명 또는 코드 입력"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onFocus={() => {
            setIsSearchFocused(true)
            preloadSymbolCache()
          }}
          onBlur={() => setIsSearchFocused(false)}
          data-testid="symbol-search-input"
        />
        <select
          className="search-select"
          value={searchMarket}
          onChange={(event) =>
            setSearchMarket(event.target.value as SearchMarket)
          }
        >
          <option value="ALL">전체</option>
          <option value="KOSPI">KOSPI</option>
          <option value="KOSDAQ">KOSDAQ</option>
        </select>
      </div>
      {showDropdown && (
        <div
          className="search-dropdown"
          style={{ marginTop: "12px" }}
          data-testid="symbol-search-dropdown"
        >
          {!symbolSearch.canSearch && (
            <div className="small-text">
              종목명 또는 코드를 입력하면 바로 검색됩니다.
            </div>
          )}
          {symbolSearch.error && (
            <div className="note-box" style={{ marginTop: "12px" }}>
              {symbolSearch.error}
            </div>
          )}
          {symbolSearch.notice && (
            <div className="note-box" style={{ marginTop: "12px" }}>
              {symbolSearch.notice.code === "SYMBOL_CACHE_MISSING" ? (
                <>
                  <strong>종목 캐시 안내</strong>
                  <div className="small-text" style={{ marginTop: "6px" }}>
                    종목 캐시가 없어 더미 데이터로 검색됩니다. 서버에서{" "}
                    <code>npm run symbols:update</code> 실행 후 최신 종목을
                    확인하세요.
                  </div>
                </>
              ) : (
                <span>{symbolSearch.notice.message}</span>
              )}
            </div>
          )}
          {symbolSearch.canSearch && (
            <>
              {symbolSearch.items.length === 0 &&
              symbolSearch.status === "ready" ? (
                <div className="empty-state" style={{ marginTop: "12px" }}>
                  검색 결과가 없습니다.
                </div>
              ) : (
                <div className="list" data-testid="symbol-search-list">
                  {symbolSearch.items.map((item) => (
                    <button
                      key={`${item.symbol}-${item.market}`}
                      className="list-row"
                      type="button"
                      data-testid="symbol-search-item"
                      onClick={() => navigate(`/stocks/${item.symbol}`)}
                    >
                      <div>
                        <strong>{item.name}</strong>
                        <div className="small-text">
                          {item.symbol} · {item.market}
                        </div>
                      </div>
                      <span className="muted">상세 보기</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="search-actions">
                <button
                  className="btn"
                  type="button"
                  data-testid="symbol-search-more"
                  disabled={
                    !symbolSearch.hasMore || symbolSearch.status === "loading"
                  }
                  onClick={symbolSearch.loadMore}
                >
                  {symbolSearch.status === "loading" ? "로딩 중..." : "더보기"}
                </button>
                {!symbolSearch.hasMore &&
                  symbolSearch.items.length > 0 &&
                  symbolSearch.status === "ready" && (
                    <span className="small-text">마지막입니다.</span>
                  )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
