import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom"
import { List, type RowComponentProps } from "react-window"
import { BrokerChart } from "./components/chart/BrokerChart/BrokerChart"
import { SymbolSearchBox } from "./components/SymbolSearchBox"
import { useLocalStorage } from "./hooks/useLocalStorage"
import {
  useCandles,
  useDisclosures,
  useIndices,
  useMarketRankings,
  useMemoStorage,
  useNews,
  useQuote,
  type RankingMode,
} from "./hooks/useMarketData"
import { useApiWarning } from "./hooks/useApiWarning"
import {
  formatDateLabel,
  formatNumber,
  formatSigned,
  formatSignedPercent,
} from "./lib/format"
import { getMarketSession } from "./lib/market"
import { resolveSessionWindow } from "./lib/session"
import { preloadSymbolCache } from "./lib/symbolCache"
import type { Candle, IndexItem, RankingItem } from "./services/api"

const APP_NAME = "최대운주식"
const MARKET_PAGE_SIZE = 50
const MARKET_ROW_GAP = 10
const MARKET_ROW_HEIGHT = 76
const MARKET_ROW_SIZE = MARKET_ROW_HEIGHT + MARKET_ROW_GAP
const MARKET_LIST_MAX_HEIGHT = 520

const MARKET_RANKING_OPTIONS: {
  mode: RankingMode
  label: string
  metricLabel: string
}[] = [
  { mode: "market_cap", label: "시가총액", metricLabel: "시가총액" },
  { mode: "volume", label: "거래량", metricLabel: "거래량" },
  { mode: "trading_value", label: "거래대금", metricLabel: "거래대금" },
  { mode: "gainers", label: "상승률", metricLabel: "상승률" },
  { mode: "losers", label: "하락률", metricLabel: "하락률" },
]

const NAV_ITEMS = [
  { label: "홈", path: "/", testId: "nav-home" },
  { label: "증시", path: "/market", testId: "nav-market" },
  { label: "설정", path: "/settings", testId: "nav-settings" },
]

const formatChangeClass = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "muted"
  }
  if (value > 0) {
    return "text-up"
  }
  if (value < 0) {
    return "text-down"
  }
  return "muted"
}

const formatRankingMetricValue = (item: RankingItem, mode: RankingMode) => {
  switch (mode) {
    case "market_cap":
      return formatNumber(item.mcap ?? undefined, "—")
    case "trading_value":
      return formatNumber(item.value ?? undefined, "—")
    case "volume":
      return formatNumber(item.volume ?? undefined, "—")
    case "gainers":
    case "losers":
      return formatSignedPercent(item.changeRate ?? undefined)
    default:
      return "-"
  }
}

const resolveSymbolRegion = (symbol: string) =>
  /^[0-9]{6}$/.test(symbol) ? "KR" : "US"

const resolveChartTimeZone = (region: "KR" | "US") =>
  region === "US" ? "America/New_York" : "Asia/Seoul"

const MarketRankingRow = memo(function MarketRankingRow({
  item,
  metricLabel,
  mode,
}: {
  item: RankingItem
  metricLabel: string
  mode: RankingMode
}) {
  return (
    <Link
      to={`/stocks/${item.code}`}
      className="list-row"
      data-testid="market-list-item"
    >
      <div>
        <strong>{item.name}</strong>
        <div className="small-text">
          {item.code} · {item.market ?? "KR"}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div>{formatNumber(item.price ?? undefined, "—")}</div>
        <div className={formatChangeClass(item.changeRate)}>
          {formatSigned(item.change ?? undefined)} (
          {formatSignedPercent(item.changeRate ?? undefined)})
        </div>
        <div className="small-text">
          {metricLabel}: {formatRankingMetricValue(item, mode)}
        </div>
      </div>
    </Link>
  )
})

type MarketListData = {
  items: RankingItem[]
  metricLabel: string
  mode: RankingMode
}

const MarketListRow = ({
  index,
  style,
  ariaAttributes,
  items,
  metricLabel,
  mode,
}: RowComponentProps<MarketListData>) => {
  const item = items[index]
  if (!item) {
    return null
  }
  return (
    <div
      {...ariaAttributes}
      style={{
        ...style,
        paddingBottom: MARKET_ROW_GAP,
        boxSizing: "border-box",
      }}
    >
      <MarketRankingRow item={item} metricLabel={metricLabel} mode={mode} />
    </div>
  )
}

const BottomNav = () => {
  const location = useLocation()

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
            to={item.path}
            data-testid={item.testId}
          >
            <span>●</span>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

const HomePage = () => {
  const navigate = useNavigate()
  const { value: favorites } = useLocalStorage<string[]>("favorites", [])

  return (
    <section className="page" data-testid="home-shell">
      <div className="app-bar">
        <div className="app-title">{APP_NAME}</div>
      </div>
      <SymbolSearchBox />

      <div className="card">
        <div className="card-row">
          <div>
            <div className="section-title">관심종목</div>
            <div className="section-subtitle">오늘도 흐름을 놓치지 마세요</div>
          </div>
          <button className="btn ghost">편집</button>
        </div>
        <div className="list" style={{ marginTop: "12px" }}>
          {favorites.length === 0 ? (
            <div className="empty-state">관심종목이 아직 없습니다.</div>
          ) : (
            favorites.map((code) => (
              <button
                key={code}
                className="list-row"
                type="button"
                onClick={() => navigate(`/stocks/${code}`)}
              >
                <div>
                  <strong>{code}</strong>
                  <div className="small-text">즐겨찾기 종목</div>
                </div>
                <span className="muted">상세 보기</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="card-grid two">
        <div className="card soft">
          <div className="section-title">바로가기</div>
          <div className="pill-row" style={{ marginTop: "12px" }}>
            <button className="btn" onClick={() => navigate("/market")}>
              증시
            </button>
            <button className="btn">검색</button>
          </div>
        </div>
        <div className="card soft">
          <div className="section-title">오늘의 요약</div>
          <p className="small-text">
            장 시작 전 체크할 지표와 이벤트를 정리했어요.
          </p>
          <div className="pill-row">
            <span className="pill">지수 변동성</span>
            <span className="pill">핵심 뉴스</span>
            <span className="pill">매수 후보</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">최대운주식 데일리 브리핑</div>
        <p className="small-text">
          오늘은 반도체, 2차전지 섹터 중심으로 거래가 집중되고 있습니다. 관심
          종목의 체결 강도를 확인하세요.
        </p>
      </div>
    </section>
  )
}

const MarketPage = () => {
  const market = "KR" as const
  const [rankingMode, setRankingMode] = useState<RankingMode>("market_cap")
  const [isSortOpen, setIsSortOpen] = useState(false)
  const indices = useIndices(market)
  const rankings = useMarketRankings(market, rankingMode, MARKET_PAGE_SIZE)
  const rankingSentinelRef = useRef<HTMLDivElement | null>(null)
  const rankingListRef = useRef<HTMLDivElement | null>(null)
  const rankingVisibleRef = useRef(false)
  const [rankingListWidth, setRankingListWidth] = useState(0)
  const session = getMarketSession()
  const rankingAutoLoad = rankings.autoLoad
  const rankingHasMore = rankings.hasMore
  const rankingIsLoadingMore = rankings.isLoadingMore
  const loadMoreRankings = rankings.loadMore

  const primaryIndexCode = "KOSPI"
  const secondaryIndexCode = "KOSDAQ"
  const primaryIndexLabel = "코스피"
  const secondaryIndexLabel = "코스닥"
  const primaryIndexTestId = "index-kospi"
  const secondaryIndexTestId = "index-kosdaq"
  const primaryIndex = indices.data.find(
    (item) => item.code === primaryIndexCode,
  )
  const secondaryIndex = indices.data.find(
    (item) => item.code === secondaryIndexCode,
  )

  const maybeLoadMoreRankings = useCallback(() => {
    if (!rankingAutoLoad || !rankingHasMore || rankingIsLoadingMore) {
      return
    }
    if (!rankingVisibleRef.current) {
      return
    }
    loadMoreRankings("auto")
  }, [loadMoreRankings, rankingAutoLoad, rankingHasMore, rankingIsLoadingMore])

  useEffect(() => {
    rankingVisibleRef.current = false
  }, [market, rankingAutoLoad, rankingMode])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const node = rankingListRef.current
    if (!node) {
      return
    }
    const update = () => {
      setRankingListWidth(node.clientWidth || 0)
    }
    update()
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update())
      observer.observe(node)
      return () => observer.disconnect()
    }
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  useEffect(() => {
    if (!rankingAutoLoad || !rankingHasMore) {
      return
    }
    const node = rankingSentinelRef.current
    if (!node) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting)
        rankingVisibleRef.current = visible
        if (visible) {
          maybeLoadMoreRankings()
        }
      },
      { rootMargin: "120px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [maybeLoadMoreRankings, rankingAutoLoad, rankingHasMore])

  const renderIndexCard = (
    item: IndexItem | undefined,
    label: string,
    testId: string,
  ) => {
    const hasValue = (item?.price ?? 0) > 0
    const errorLabel =
      indices.status === "error"
        ? `지수 조회 실패${indices.error ? `: ${indices.error}` : ""}`
        : ""
    const pendingLabel =
      indices.status === "loading" || indices.status === "idle"
        ? "지수 조회 중"
        : "지수 데이터 없음"
    const statusLabel = errorLabel || (!hasValue ? pendingLabel : "")
    const priceLabel = hasValue ? formatNumber(item?.price) : statusLabel
    const changeLabel = hasValue ? formatSignedPercent(item?.changeRate) : "-"

    return (
      <div className="card soft" data-testid={testId}>
        <div className="card-row">
          <div>
            <div className="section-title">{label}</div>
            <div className="small-text" data-testid={`${testId}-session`}>
              {session.label}
            </div>
            {item?.isFallback && item.refDate && (
              <div className="small-text" data-testid={`${testId}-fallback`}>
                최근 영업일 종가({item.refDate}) 기준
              </div>
            )}
            {statusLabel && (
              <div className="small-text" data-testid={`${testId}-status`}>
                {statusLabel}
              </div>
            )}
          </div>
          <span className="tag">{session.isOpen ? "LIVE" : "CLOSE"}</span>
        </div>
        <div className="stock-price" data-testid={`${testId}-last`}>
          {priceLabel}
        </div>
        <div
          className={formatChangeClass(item?.changeRate)}
          data-testid={`${testId}-change`}
        >
          {changeLabel}
        </div>
      </div>
    )
  }

  const activeRankingLabel =
    MARKET_RANKING_OPTIONS.find((item) => item.mode === rankingMode)?.label ??
    "정렬"
  const activeMetricLabel =
    MARKET_RANKING_OPTIONS.find((item) => item.mode === rankingMode)
      ?.metricLabel ?? "지표"
  const rankingListData = useMemo(
    () => ({
      items: rankings.items,
      metricLabel: activeMetricLabel,
      mode: rankingMode,
    }),
    [activeMetricLabel, rankingMode, rankings.items],
  )
  const rankingListHeight = Math.min(
    Math.max(rankings.items.length, 1) * MARKET_ROW_SIZE,
    MARKET_LIST_MAX_HEIGHT,
  )
  const rankingListWidthSafe = rankingListWidth || 640

  return (
    <section className="page">
      <div className="app-bar">
        <div className="app-title">{APP_NAME} 증시</div>
        <span className="tag">{market}</span>
      </div>
      <SymbolSearchBox />
      <div className="card-grid two">
        {renderIndexCard(primaryIndex, primaryIndexLabel, primaryIndexTestId)}
        {renderIndexCard(
          secondaryIndex,
          secondaryIndexLabel,
          secondaryIndexTestId,
        )}
      </div>

      <div className="card">
        <div className="card-row">
          <div>
            <div className="section-title">시장 랭킹</div>
            <div className="section-subtitle">
              오늘의 상위 종목을 확인하세요
            </div>
          </div>
          <div className="sort-control">
            <button
              className="btn ghost sort-trigger"
              type="button"
              data-testid="market-sort-trigger"
              onClick={() => setIsSortOpen((prev) => !prev)}
            >
              정렬 기준 · {activeRankingLabel}
            </button>
            {isSortOpen && (
              <div className="sort-menu" data-testid="market-sort-menu">
                {MARKET_RANKING_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    className={`btn ghost ${rankingMode === option.mode ? "active" : ""}`}
                    type="button"
                    data-testid={`market-sort-option-${option.mode}`}
                    onClick={() => {
                      setRankingMode(option.mode)
                      setIsSortOpen(false)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {rankings.status === "error" && (
          <div className="note-box" style={{ marginTop: "12px" }}>
            랭킹 데이터를 불러오지 못했습니다.
            {rankings.error ? ` (${rankings.error})` : ""}
          </div>
        )}
        {rankings.items.length === 0 && rankings.status === "loading" ? (
          <div
            className="list"
            data-testid="market-list"
            data-total-count="0"
            style={{ marginTop: "12px" }}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`skeleton-${index}`} className="list-row skeleton">
                <div className="skeleton-line" style={{ width: "52%" }} />
                <div className="skeleton-line" style={{ width: "28%" }} />
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={rankingListRef}
            className="list"
            data-testid="market-list"
            data-total-count={rankings.items.length}
            style={{ marginTop: "12px" }}
          >
            <List
              rowCount={rankingListData.items.length}
              rowHeight={MARKET_ROW_SIZE}
              rowComponent={MarketListRow}
              rowProps={rankingListData}
              style={{
                height: rankingListHeight,
                width: rankingListWidthSafe,
              }}
            />
          </div>
        )}
        <div className="more-panel" data-testid="market-more-panel">
          <button
            className="btn"
            type="button"
            data-testid="market-more-button"
            onClick={() => rankings.loadMore("manual")}
            disabled={!rankings.hasMore || rankings.isLoadingMore}
          >
            {rankings.isLoadingMore ? "로딩 중..." : "더보기"}
          </button>
          {!rankings.hasMore && (
            <span className="small-text">마지막입니다.</span>
          )}
        </div>
        {rankings.autoLoad && rankings.hasMore && (
          <div
            ref={rankingSentinelRef}
            className="small-text"
            data-testid="market-sentinel"
            style={{ marginTop: "8px" }}
          >
            스크롤하면 {MARKET_PAGE_SIZE}개씩 추가됩니다.
          </div>
        )}
      </div>
    </section>
  )
}

const SettingsPage = () => (
  <section className="page">
    <div className="app-bar">
      <div className="app-title">{APP_NAME} 설정</div>
    </div>
    <div className="card">
      <div className="section-title">알림 설정</div>
      <div className="toggle-row">
        <span>시세 변동 알림</span>
        <button className="toggle on" type="button" />
      </div>
      <div className="toggle-row">
        <span>뉴스 업데이트</span>
        <button className="toggle" type="button" />
      </div>
      <div className="toggle-row">
        <span>공시 알림</span>
        <button className="toggle" type="button" />
      </div>
    </div>
    <div className="card soft">
      <div className="section-title">서비스 상태</div>
      <p className="small-text">
        실시간 연결 상태와 캐시 동작을 확인할 수 있어요.
      </p>
    </div>
  </section>
)

const StockOverview = ({
  candles,
  disclosures,
}: {
  candles: Candle[]
  disclosures: string[]
}) => {
  const recent = candles.slice(-20)
  const avgVolume =
    recent.reduce((acc, item) => acc + item.volume, 0) / (recent.length || 1)
  const lastVolume = candles[candles.length - 1]?.volume ?? 0
  const volumeRatio = avgVolume ? lastVolume / avgVolume : 0
  const volumeLabel =
    volumeRatio > 1.5 ? "높음" : volumeRatio > 0.9 ? "보통" : "낮음"

  const disclosureScore = disclosures.reduce(
    (acc, item) => {
      if (
        item.includes("취득") ||
        item.includes("증자") ||
        item.includes("합병")
      ) {
        acc.good += 1
      }
      if (
        item.includes("손실") ||
        item.includes("중단") ||
        item.includes("사고")
      ) {
        acc.bad += 1
      }
      return acc
    },
    { good: 0, bad: 0 },
  )

  return (
    <div className="card-grid two" data-testid="stock-overview">
      <div className="card">
        <div className="section-title">기술적 지표</div>
        <div className="pill-row" style={{ marginTop: "10px" }}>
          <span className="pill active">매수 4</span>
          <span className="pill">중립 2</span>
          <span className="pill">매도 1</span>
        </div>
      </div>
      <div className="card">
        <div className="section-title">차트 패턴</div>
        <p className="small-text">최근 변동성 확대, 패턴 없음</p>
      </div>
      <div className="card">
        <div className="section-title">시장 관심도</div>
        <div className="stock-price">{volumeLabel}</div>
        <div className="small-text">
          최근 거래량 대비 {formatSignedPercent(volumeRatio * 100 - 100)}
        </div>
      </div>
      <div className="card">
        <div className="section-title">공시 현황</div>
        <div className="pill-row" style={{ marginTop: "8px" }}>
          <span className="pill">호재 {disclosureScore.good}</span>
          <span className="pill">악재 {disclosureScore.bad}</span>
        </div>
      </div>
    </div>
  )
}

const StockDetailPage = () => {
  const navigate = useNavigate()
  const { symbol = "005930" } = useParams()
  const [activeTab, setActiveTab] = useState("차트")
  const [subTab, setSubTab] = useState("뉴스")
  const [trendTab, setTrendTab] = useState("일별시세")
  const [showAi, setShowAi] = useState(false)
  const [showSimilar, setShowSimilar] = useState(false)

  const { value: favorites, setValue: setFavorites } = useLocalStorage<
    string[]
  >("favorites", [])
  const isFavorite = favorites.includes(symbol)

  const region = resolveSymbolRegion(symbol)
  const chartTimeZone = resolveChartTimeZone(region)

  const quote = useQuote(symbol)
  const candles = useCandles(symbol, "1d", 60000, region)
  const news = useNews(symbol, "KR")
  const disclosures = useDisclosures(symbol, "KR")
  const memo = useMemoStorage(symbol)
  const [memoTitle, setMemoTitle] = useState("")
  const [memoBody, setMemoBody] = useState("")

  const changeClass = formatChangeClass(quote.data?.changeRate)
  const sessionWindow = quote.data?.session ?? resolveSessionWindow(region)
  const session = getMarketSession(sessionWindow)
  const quoteHasValue = (quote.data?.price ?? 0) > 0
  const quoteErrorLabel =
    quote.status === "error"
      ? `시세 조회 실패${quote.error ? `: ${quote.error}` : ""}`
      : ""
  const quotePendingLabel =
    quote.status === "loading" || quote.status === "idle"
      ? "시세 조회 중"
      : "시세 데이터 없음"
  const quoteStatusLabel =
    quoteErrorLabel || (!quoteHasValue ? quotePendingLabel : "")
  const quotePriceLabel = quoteHasValue
    ? formatNumber(quote.data?.price)
    : quoteStatusLabel
  const formatCandleDate = (value: string | number) => {
    if (typeof value === "string") {
      return formatDateLabel(value)
    }
    const epochMs = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(epochMs)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}.${month}.${day}`
  }
  const newsErrorLabel =
    news.status === "error"
      ? `뉴스 조회 실패${news.error ? `: ${news.error}` : ""}`
      : ""
  const disclosuresErrorLabel =
    disclosures.status === "error"
      ? `공시 조회 실패${disclosures.error ? `: ${disclosures.error}` : ""}`
      : ""

  const toggleFavorite = () => {
    if (isFavorite) {
      setFavorites(favorites.filter((item) => item !== symbol))
    } else {
      setFavorites([...favorites, symbol])
    }
  }

  const addMemo = () => {
    if (!memoTitle.trim()) {
      return
    }
    memo.setItems([
      {
        id: `${Date.now()}`,
        title: memoTitle.trim(),
        body: memoBody.trim(),
        createdAt: new Date().toISOString(),
      },
      ...memo.items,
    ])
    setMemoTitle("")
    setMemoBody("")
  }

  const rankingDisclosureTitles = disclosures.data.map((item) => item.title)

  return (
    <section className="page">
      <div className="card">
        <div className="stock-headline">
          <button className="btn icon" onClick={() => navigate(-1)}>
            ←
          </button>
          <div style={{ textAlign: "center" }}>
            <h1>
              {quote.data?.name ?? symbol} ({symbol})
            </h1>
            <div className="small-text">{APP_NAME}</div>
          </div>
          <button className="btn icon" onClick={toggleFavorite}>
            {isFavorite ? "★" : "☆"}
          </button>
        </div>
        <div className="stock-header">
          <div className="stock-price" data-testid="quote-last">
            {quotePriceLabel}
          </div>
          <div className={changeClass} data-testid="quote-change">
            {formatSigned(quote.data?.change)} (
            {formatSignedPercent(quote.data?.changeRate)})
          </div>
          {quoteHasValue && quoteStatusLabel && (
            <div className="small-text" data-testid="quote-status">
              {quoteStatusLabel}
            </div>
          )}
          <div className="pill-row" data-testid="quote-session">
            <span className="pill">{sessionWindow.label}</span>
            <span className={`pill ${session.isOpen ? "active" : ""}`}>
              {session.label}
            </span>
          </div>
          <div className="stock-actions">
            <button onClick={() => setShowAi(true)}>AI분석</button>
            <button onClick={() => setShowSimilar(true)}>유사차트</button>
            <button onClick={() => setActiveTab("메모")}>복기</button>
            <button onClick={() => toggleFavorite()}>대기열</button>
          </div>
        </div>
      </div>

      <div className="card">
        <BrokerChart
          symbol={symbol}
          region={region}
          timeZone={chartTimeZone}
          quote={quote.data}
          session={sessionWindow}
          name={quote.data?.name}
        />
      </div>

      <div className="tab-row">
        {["차트", "개요", "시세동향", "재무", "뉴스/공시", "메모"].map(
          (item) => (
            <button
              key={item}
              className={activeTab === item ? "active" : ""}
              onClick={() => setActiveTab(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>

      {activeTab === "차트" && (
        <div className="card">
          <div className="section-title">차트 해설</div>
          <p className="small-text">캔들, 거래량, MA 기준 추세를 확인하세요.</p>
        </div>
      )}

      {activeTab === "개요" && (
        <StockOverview
          candles={candles.data}
          disclosures={rankingDisclosureTitles}
        />
      )}

      {activeTab === "시세동향" && (
        <div className="card">
          <div className="tab-row">
            {["일별시세", "투자자동향"].map((item) => (
              <button
                key={item}
                className={trendTab === item ? "active" : ""}
                onClick={() => setTrendTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {trendTab === "일별시세" ? (
            <table className="table" style={{ marginTop: "12px" }}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>종가</th>
                  <th>등락</th>
                  <th>거래량</th>
                </tr>
              </thead>
              <tbody>
                {candles.data.slice(-10).map((item) => (
                  <tr key={item.time}>
                    <td>{formatCandleDate(item.time)}</td>
                    <td>{formatNumber(item.close)}</td>
                    <td className={formatChangeClass(item.close - item.open)}>
                      {formatSigned(item.close - item.open)}
                    </td>
                    <td>{formatNumber(item.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              데이터 소스 미지원: 투자자동향 정보를 제공하지 않습니다.
            </div>
          )}
        </div>
      )}

      {activeTab === "재무" && (
        <div className="card">
          <div className="section-title">재무 요약</div>
          <div className="card-grid two" style={{ marginTop: "12px" }}>
            {["PER", "EPS", "PBR", "BPS"].map((item) => (
              <div key={item} className="note-box">
                <div className="small-text">{item}</div>
                <div className="stock-price">--</div>
              </div>
            ))}
          </div>
          <div className="small-text" style={{ marginTop: "12px" }}>
            재무 데이터 소스가 제공되지 않아 요약만 표시합니다.
          </div>
        </div>
      )}

      {activeTab === "뉴스/공시" && (
        <div className="card">
          <div className="tab-row">
            {["뉴스", "공시"].map((item) => (
              <button
                key={item}
                className={subTab === item ? "active" : ""}
                onClick={() => setSubTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {subTab === "뉴스" ? (
            <>
              {newsErrorLabel && (
                <div className="note-box" data-testid="news-status">
                  {newsErrorLabel}
                </div>
              )}
              {news.data.length === 0 && news.status === "loading" ? (
                <div className="empty-state" style={{ marginTop: "12px" }}>
                  뉴스를 불러오는 중입니다.
                </div>
              ) : (
                <div
                  className="list"
                  style={{ marginTop: "12px" }}
                  data-testid="stock-news"
                >
                  {news.data.slice(0, 10).map((item) => (
                    <a
                      key={item.id}
                      className="list-row"
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <div className="small-text">
                          {item.source} · {item.date}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {disclosuresErrorLabel && (
                <div className="note-box" data-testid="disclosures-status">
                  {disclosuresErrorLabel}
                </div>
              )}
              {disclosures.data.length === 0 &&
              disclosures.status === "loading" ? (
                <div className="empty-state" style={{ marginTop: "12px" }}>
                  공시를 불러오는 중입니다.
                </div>
              ) : (
                <div
                  className="list"
                  style={{ marginTop: "12px" }}
                  data-testid="stock-disclosures"
                >
                  {disclosures.data.slice(0, 10).map((item) => (
                    <a
                      key={item.id}
                      className="list-row"
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <div className="small-text">
                          {item.source} · {item.date}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "메모" && (
        <div className="card">
          <div className="section-title">메모</div>
          <div className="field" style={{ marginTop: "12px" }}>
            <input
              placeholder="제목"
              value={memoTitle}
              onChange={(event) => setMemoTitle(event.target.value)}
            />
            <textarea
              placeholder="내용을 입력하세요"
              value={memoBody}
              onChange={(event) => setMemoBody(event.target.value)}
            />
            <button className="btn primary" onClick={addMemo}>
              저장
            </button>
          </div>
          <div className="list" style={{ marginTop: "12px" }}>
            {memo.items.length === 0 && (
              <div className="empty-state">작성된 메모가 없습니다.</div>
            )}
            {memo.items.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <strong>{item.title}</strong>
                  <div className="small-text">{item.body}</div>
                </div>
                <span className="small-text">
                  {formatDateLabel(item.createdAt.slice(0, 8))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAi && (
        <div className="modal-backdrop" onClick={() => setShowAi(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>AI 분석 요약</h3>
            <div className="note-box">AI 분석은 준비중입니다.</div>
            <button className="btn primary" onClick={() => setShowAi(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {showSimilar && (
        <div className="modal-backdrop" onClick={() => setShowSimilar(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>유사차트 후보</h3>
            <div className="list">
              {["패턴A", "패턴B", "패턴C", "패턴D", "패턴E"].map((item) => (
                <div key={item} className="list-row">
                  <strong>{item}</strong>
                  <span className="small-text">일치도 78%</span>
                </div>
              ))}
            </div>
            <button
              className="btn primary"
              onClick={() => setShowSimilar(false)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

const App = () => {
  const location = useLocation()
  const showNav = !location.pathname.startsWith("/stocks/")
  const { warning, message: apiWarningMessage, dismiss } = useApiWarning()

  useEffect(() => {
    preloadSymbolCache()
  }, [])

  return (
    <main className="app">
      <div className="app-shell">
        {warning && (
          <div className="note-box" data-testid="api-warning">
            <div className="card-row">
              <span>{apiWarningMessage}</span>
              <button className="btn ghost" onClick={dismiss}>
                닫기
              </button>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/rankings" element={<Navigate to="/market" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/stocks/:symbol" element={<StockDetailPage />} />
        </Routes>
      </div>
      {showNav && <BottomNav />}
    </main>
  )
}

export default App
