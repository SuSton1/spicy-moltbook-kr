import fs from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { formatNumber } from "../../src/lib/format"
import { normalizeQuoteMetrics } from "../../src/lib/kisMetrics"
import { sortRankingItems } from "../../src/lib/rankings"
import { mergeUsSymbols } from "../../src/lib/usSymbols"

const dataMode = process.env.E2E_DATA_MODE ?? "contract"
const symbol = process.env.E2E_SYMBOL_KR ?? "005930"

const contractFixturePath = path.join(
  process.cwd(),
  "server",
  "data",
  "kis.contract.json",
)
const contractFixture = JSON.parse(
  fs.readFileSync(contractFixturePath, "utf8"),
) as {
  symbols: string[]
  quotes: Record<string, { output: Record<string, unknown> }>
}

const MARKET_PAGE_SIZE = 50
const MARKET_ROW_SIZE = 86

const readMarketTotal = async (page: Page) => {
  const attr = await page
    .getByTestId("market-list")
    .getAttribute("data-total-count")
  return Number(attr ?? "0")
}

const waitForMarketTotalIncrease = async (page: Page, previous: number) => {
  await expect.poll(() => readMarketTotal(page)).toBeGreaterThan(previous)
}

const loadMarketPagesForIndex = async (page: Page, index: number) => {
  const requiredPages = Math.max(1, Math.ceil((index + 1) / MARKET_PAGE_SIZE))
  for (let pageIndex = 1; pageIndex < requiredPages; pageIndex += 1) {
    const before = await readMarketTotal(page)
    await page.getByTestId("market-more-button").click()
    await waitForMarketTotalIncrease(page, before)
  }
}

const scrollMarketToIndex = async (page: Page, index: number) => {
  const scrollTop = index * MARKET_ROW_SIZE
  const list = page.locator("[data-testid='market-list'] > div").first()
  await list.evaluate((node, top) => {
    node.scrollTop = top
  }, scrollTop)
}

type SymbolSnapshotItem = {
  symbol: string
  name: string
  market: string
}

const symbolSnapshotPath = path.join(
  process.cwd(),
  "server",
  "data",
  "symbols.all.json",
)
const symbolSnapshot = JSON.parse(
  fs.readFileSync(symbolSnapshotPath, "utf8"),
) as SymbolSnapshotItem[]
const usNasdaqSnapshotPath = path.join(
  process.cwd(),
  "server",
  "data",
  "symbols.us.nasdaq.json",
)
const usDowSnapshotPath = path.join(
  process.cwd(),
  "server",
  "data",
  "symbols.us.dowjones.json",
)
const usNasdaqSnapshot = JSON.parse(
  fs.readFileSync(usNasdaqSnapshotPath, "utf8"),
) as SymbolSnapshotItem[]
const usDowSnapshot = JSON.parse(
  fs.readFileSync(usDowSnapshotPath, "utf8"),
) as SymbolSnapshotItem[]
const usAllSnapshot = mergeUsSymbols(usNasdaqSnapshot, usDowSnapshot)

const usQuotesPath = path.join(
  process.cwd(),
  "server",
  "data",
  "quotes.us.contract.json",
)
const usQuoteFixtures = fs.existsSync(usQuotesPath)
  ? (JSON.parse(fs.readFileSync(usQuotesPath, "utf8")) as Record<
      string,
      { price?: number; marketCap?: number }
    >)
  : {}
const usQuoteAapl = usQuoteFixtures.AAPL
const usQuoteAaplPriceLabel = usQuoteAapl?.price
  ? formatNumber(usQuoteAapl.price)
  : ""
const usQuoteAaplMcapLabel = usQuoteAapl?.marketCap
  ? formatNumber(usQuoteAapl.marketCap)
  : ""

const usIndicesPath = path.join(
  process.cwd(),
  "server",
  "data",
  "indices.us.json",
)
const usIndicesFixture = JSON.parse(fs.readFileSync(usIndicesPath, "utf8")) as {
  code: string
  price: number
}[]
const nasdaqIndexFixture = usIndicesFixture.find(
  (item) => item.code === "NASDAQ",
)
const dowIndexFixture = usIndicesFixture.find(
  (item) => item.code === "DOWJONES",
)
const nasdaqIndexLabel = nasdaqIndexFixture
  ? formatNumber(nasdaqIndexFixture.price)
  : ""
const dowIndexLabel = dowIndexFixture ? formatNumber(dowIndexFixture.price) : ""
const contractSymbolSet = new Set(contractFixture.symbols)

const buildFixtureRankingItems = (items: SymbolSnapshotItem[]) =>
  items.map((item, index) => {
    const price = 12000 + index * 240
    const change = (index % 2 === 0 ? 1 : -1) * (6 + index * 2)
    const changeRate = Number(((change / price) * 100).toFixed(2))
    const volume = 800000 + index * 42000
    const value = price * volume
    return {
      rank: index + 1,
      code: item.symbol,
      name: item.name,
      market: item.market,
      price,
      change,
      changeRate,
      volume,
      value,
      mcap: value * 4.2,
    }
  })

const buildContractRankingItems = () => {
  const baseItems = buildFixtureRankingItems(symbolSnapshot)
  const map = new Map(baseItems.map((item) => [item.code, item]))
  contractFixture.symbols.forEach((code) => {
    const output = contractFixture.quotes[code]?.output
    if (!output) {
      return
    }
    const metrics = normalizeQuoteMetrics(output)
    const existing = map.get(code)
    if (!existing) {
      return
    }
    map.set(code, {
      ...existing,
      volume: metrics.volume,
      value: metrics.turnover,
      mcap: metrics.marketCap,
    })
  })
  return Array.from(map.values())
}

const sortedContractItems = sortRankingItems(
  buildContractRankingItems(),
  "turnover",
  "desc",
)
const sortedUsItems = sortRankingItems(
  buildFixtureRankingItems(usAllSnapshot),
  "volume",
  "desc",
)
const contractSymbolIndex = sortedContractItems.findIndex((item) =>
  contractSymbolSet.has(item.code),
)
const targetIndex =
  contractSymbolIndex >= 0 && contractSymbolIndex < MARKET_PAGE_SIZE * 2
    ? contractSymbolIndex
    : 0
const targetItem = sortedContractItems[targetIndex]
const targetTradingValueLabel =
  targetItem.value === null || targetItem.value === undefined
    ? "—"
    : formatNumber(targetItem.value)

test("contract 홈 쉘과 증시 이동", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("home-shell")).toBeVisible()
  await expect(page.locator("[data-testid='nav-rankings']")).toHaveCount(0)
  await page.getByTestId("nav-market").click()
  await expect(page.getByTestId("api-warning")).toHaveCount(0)
  await expect(page.getByTestId("index-kospi")).toBeVisible()
  await expect(page.getByTestId("index-kospi-last")).toContainText(/\d/, {
    timeout: 1000,
  })
  await expect(page.getByTestId("index-kosdaq-last")).toContainText(/\d/, {
    timeout: 1000,
  })
  await expect(page.getByTestId("index-kospi-session")).toContainText(/장/)
})

test("contract 종목 상세 차트/뉴스/공시", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")
  const newsTab = page.getByRole("button", { name: "뉴스/공시" })
  await newsTab.waitFor()
  await newsTab.dispatchEvent("click")
  await expect(page.getByTestId("stock-news")).toContainText(/\S+/)
  const disclosureTab = page.getByRole("button", {
    name: "공시",
    exact: true,
  })
  await disclosureTab.waitFor()
  await disclosureTab.dispatchEvent("click")
  await expect(page.getByTestId("stock-disclosures")).toContainText(/\S+/)
})

test("contract 차트 분봉 간격 선택", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-price-pane")).toBeVisible()
  await expect(page.getByTestId("chart-volume-pane")).toBeVisible()
  await page.getByTestId("intraday-interval-trigger").click()
  await expect(page.getByTestId("intraday-interval-menu")).toBeVisible()
  const intervalKeys = ["1m", "3m", "5m", "10m", "15m", "30m", "1h", "4h"]
  for (const key of intervalKeys) {
    await expect(
      page.getByTestId(`intraday-interval-option-${key}`),
    ).toBeVisible()
  }
  await page.getByTestId("intraday-interval-option-1m").click()
  await expect
    .poll(async () => {
      const countText = await page
        .getByTestId("chart-candle-count")
        .textContent()
      return Number(countText ?? "0")
    })
    .toBeGreaterThan(350)
  await expect(page.getByTestId("chart-error")).toHaveCount(0)
  const rangeText = await page.getByTestId("chart-range").textContent()
  expect(rangeText ?? "").toMatch(/09:/)
  expect(rangeText ?? "").toMatch(/09:00/)
  expect(rangeText ?? "").toMatch(/15:/)
  expect(rangeText ?? "").not.toMatch(/22:/)
  await expect(page.getByTestId("chart-error")).toHaveCount(0)

  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-5m").click()
  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-10m").click()
  await expect(page.getByTestId("chart-error")).toHaveCount(0)

  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-3m").click()
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")

  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-1h").click()
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")
})

test("contract 분봉 전환 시 요청 스팸 없음", async ({ page }) => {
  const intradayRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/chart/intraday")) {
      intradayRequests.push(request.url())
    }
  })

  await page.goto(`/stocks/${symbol}`)
  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-1m").click()
  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-5m").click()
  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-3m").click()
  await page.waitForTimeout(600)

  expect(intradayRequests.length).toBeLessThanOrEqual(2)
})

test("contract 종목 상세 개요 탭 클릭", async ({ page }) => {
  const errors: Error[] = []
  page.on("pageerror", (error) => {
    errors.push(error)
  })

  await page.goto(`/stocks/${symbol}`)
  const overviewTab = page.getByRole("button", { name: "개요" })
  await overviewTab.waitFor()
  await overviewTab.click()
  await expect(page.getByTestId("stock-overview")).toBeVisible({
    timeout: 1000,
  })
  expect(errors).toHaveLength(0)
})

test("contract 종목 검색 즉시 결과", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("symbol-search-input").fill("삼성")
  await expect(page.getByTestId("symbol-search-item").first()).toBeVisible({
    timeout: 1000,
  })
  await page.getByTestId("symbol-search-item").first().click()
  await expect(page).toHaveURL(/stocks/)
})

test("contract 증시 더보기 무한스크롤", async ({ page }) => {
  await page.goto("/market")
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-volume").click()
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  await expect.poll(() => readMarketTotal(page)).toBeGreaterThan(5)
  const firstCount = await readMarketTotal(page)
  await expect(page.getByTestId("market-more-panel")).toBeVisible()
  await page.getByTestId("market-more-button").click()
  await waitForMarketTotalIncrease(page, firstCount)
  const secondCount = await readMarketTotal(page)
  await page.getByTestId("market-more-button").click()
  await waitForMarketTotalIncrease(page, secondCount)
  const thirdCount = await readMarketTotal(page)
  if ((await page.getByTestId("market-sentinel").count()) > 0) {
    await page.getByTestId("market-sentinel").scrollIntoViewIfNeeded()
    await expect.poll(() => readMarketTotal(page)).toBeGreaterThan(thirdCount)
  }
})

test("contract 종목 검색이 랭킹에 영향 없음", async ({ page }) => {
  await page.goto("/market")
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  const before = await page
    .getByTestId("market-list-item")
    .first()
    .textContent()
  await page.getByTestId("symbol-search-input").fill("삼성")
  await expect(page.getByTestId("symbol-search-item").first()).toBeVisible({
    timeout: 1000,
  })
  await page.getByTestId("symbol-search-input").fill("")
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  const after = await page.getByTestId("market-list-item").first().textContent()
  expect(after?.trim()).toEqual(before?.trim())
})

test("contract 시가총액 상위 삼성전자", async ({ page }) => {
  await page.goto("/market")
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-market_cap").click()
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  await expect(page.getByTestId("market-list-item").first()).toContainText(
    "삼성전자",
  )
})

test("contract 해외 증시 랭킹/더보기/정렬", async ({ page }) => {
  await page.goto("/market")
  await page.getByRole("button", { name: "해외" }).click()
  await expect(page.getByTestId("market-group-nasdaq")).toHaveCount(0)
  await expect(page.getByTestId("market-group-dowjones")).toHaveCount(0)
  await expect(page.getByTestId("market-group-nyse")).toHaveCount(0)
  await expect(page.getByTestId("index-nasdaq")).toBeVisible()
  await expect(page.getByTestId("index-dowjones")).toBeVisible()
  if (nasdaqIndexLabel) {
    await expect(page.getByTestId("index-nasdaq-last")).toContainText(
      nasdaqIndexLabel,
    )
  }
  if (dowIndexLabel) {
    await expect(page.getByTestId("index-dowjones-last")).toContainText(
      dowIndexLabel,
    )
  }
  await expect(page.getByText("코스피", { exact: true })).toHaveCount(0)
  await expect(page.getByText("코스닥", { exact: true })).toHaveCount(0)

  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-volume").click()
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  if (sortedUsItems[0]) {
    await expect(page.getByTestId("market-list-item").first()).toContainText(
      sortedUsItems[0].code,
    )
  }
  await expect(
    page
      .getByTestId("market-list-item")
      .filter({ hasText: "DOWJONES" })
      .first(),
  ).toBeVisible()
  await scrollMarketToIndex(page, 35)
  await expect(
    page.getByTestId("market-list-item").filter({ hasText: "NASDAQ" }).first(),
  ).toBeVisible()
  const firstCount = await readMarketTotal(page)
  expect(firstCount).toBeGreaterThan(5)
  await page.getByTestId("market-more-button").click()
  await waitForMarketTotalIncrease(page, firstCount)

  const firstLabel = await page
    .getByTestId("market-list-item")
    .first()
    .textContent()
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-gainers").click()
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-losers").click()
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1000,
  })
  const secondLabel = await page
    .getByTestId("market-list-item")
    .first()
    .textContent()
  expect(firstLabel?.trim()).not.toEqual(secondLabel?.trim())
})

test("contract 해외 시세/시가총액 표시", async ({ page }) => {
  await page.goto("/market")
  await page.getByRole("button", { name: "해외" }).click()
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-market_cap").click()
  const firstRow = page.getByTestId("market-list-item").first()
  await expect(firstRow).toContainText("AAPL")
  await expect(firstRow).toContainText(usQuoteAaplPriceLabel)
  await expect(firstRow).toContainText(usQuoteAaplMcapLabel)
})

test("contract 거래대금 표시 정확도", async ({ page }) => {
  await page.goto("/market")
  await page.getByTestId("market-sort-trigger").click()
  await page.getByTestId("market-sort-option-trading_value").click()

  await loadMarketPagesForIndex(page, targetIndex)
  await scrollMarketToIndex(page, targetIndex)
  const row = page
    .getByTestId("market-list-item")
    .filter({ hasText: targetItem.code })
  await expect(row.first()).toBeVisible({ timeout: 2000 })
  await expect(row.first()).toContainText(targetTradingValueLabel)
})

test("kis 종목 상세 실데이터", async ({ page }) => {
  test.skip(dataMode !== "kis", "E2E_DATA_MODE=kis 일 때만 실행")
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("quote-last")).toContainText(/\d/)
  await expect(page.getByTestId("quote-change")).toContainText(/\d/)
  await expect(page.getByTestId("quote-session")).toContainText(/장/)

  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-1m").click()
  await expect(page.getByTestId("intraday-interval-trigger")).toHaveClass(
    /active/,
  )
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")
})
