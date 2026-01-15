import fs from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { formatNumber } from "../../src/lib/format"
import { normalizeQuoteMetrics } from "../../src/lib/kisMetrics"
import { sortRankingItems } from "../../src/lib/rankings"

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

test("contract 크로스헤어 이동 시 OHLC 패널 갱신", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")
  const panel = page.getByTestId("chart-ohlc-panel")
  await expect(panel).toBeVisible()

  const before = await panel.textContent()
  const pricePane = page.getByTestId("chart-price-pane")
  const box = await pricePane.boundingBox()
  expect(box).not.toBeNull()
  if (!box) {
    return
  }

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
  await page.waitForTimeout(50)
  const first = await panel.textContent()

  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3)
  await page.waitForTimeout(50)
  const second = await panel.textContent()

  expect(first).not.toEqual(before)
  expect(second).not.toEqual(first)
})

test("contract OHLC 패널이 캔들을 가리지 않음", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")

  const panel = page.getByTestId("chart-ohlc-panel")
  const pricePane = page.getByTestId("chart-price-pane")
  await expect(panel).toBeVisible()
  await expect(pricePane).toBeVisible()

  const panelBox = await panel.boundingBox()
  const priceBox = await pricePane.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(priceBox).not.toBeNull()
  if (!panelBox || !priceBox) {
    return
  }

  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(priceBox.y + 1)
})

test("contract 가격/거래량 pane plot 너비 동일", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")
  await expect(page.getByTestId("chart-price-pane")).toBeVisible()
  await expect(page.getByTestId("chart-volume-pane")).toBeVisible()

  const widths = await page.evaluate(() => {
    const readPlotWidth = (testId: string) => {
      const container = document.querySelector(
        `[data-testid='${testId}']`,
      ) as HTMLElement | null
      if (!container) {
        return null
      }
      const containerRect = container.getBoundingClientRect()
      const canvases = Array.from(container.querySelectorAll("canvas"))
      const tall = canvases
        .map((canvas) => canvas.getBoundingClientRect())
        .filter((rect) => rect.height >= containerRect.height * 0.5)
      if (tall.length === 0) {
        return null
      }
      const widest = tall.reduce((acc, rect) =>
        rect.width > acc.width ? rect : acc,
      )
      return Math.round(widest.width)
    }

    return {
      price: readPlotWidth("chart-price-pane"),
      volume: readPlotWidth("chart-volume-pane"),
    }
  })

  expect(widths.price).not.toBeNull()
  expect(widths.volume).not.toBeNull()
  if (widths.price === null || widths.volume === null) {
    return
  }
  expect(Math.abs(widths.price - widths.volume)).toBeLessThanOrEqual(1)
})

test("contract 차트 줌/팬 동작", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-visible-range")).not.toHaveText("")

  const pricePane = page.getByTestId("chart-price-pane")
  const box = await pricePane.boundingBox()
  expect(box).not.toBeNull()
  if (!box) {
    return
  }

  const rangeLabel = page.getByTestId("chart-visible-range")
  const before = await rangeLabel.textContent()

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.wheel(0, -420)
  await page.waitForTimeout(200)
  const afterZoom = await rangeLabel.textContent()
  expect(afterZoom).not.toEqual(before)

  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5, {
    steps: 8,
  })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterPan = await rangeLabel.textContent()
  expect(afterPan).not.toEqual(afterZoom)
})

test("contract 일/주/월 전환 시 에러 없음", async ({ page }) => {
  await page.goto(`/stocks/${symbol}`)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")

  await page.getByTestId("tf-1w").click()
  await expect(page.getByTestId("chart-error")).toHaveCount(0)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")

  await page.getByTestId("tf-1mo").click()
  await expect(page.getByTestId("chart-error")).toHaveCount(0)
  await expect(page.getByTestId("chart-candle-count")).not.toHaveText("0")

  await page.getByTestId("tf-1d").click()
  await expect(page.getByTestId("chart-error")).toHaveCount(0)
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

test("contract intraday 요청 폴링 상한", async ({ page }) => {
  const intradayRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/chart/intraday")) {
      intradayRequests.push(request.url())
    }
  })

  await page.goto(`/stocks/${symbol}`)
  await page.getByTestId("intraday-interval-trigger").click()
  await page.getByTestId("intraday-interval-option-1m").click()
  await page.waitForTimeout(12_000)

  expect(intradayRequests.length).toBeLessThanOrEqual(3)
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

test("contract 증시탭 해외 버튼 없음", async ({ page }) => {
  await page.goto("/market")
  await expect(page.getByRole("button", { name: "해외" })).toHaveCount(0)
})

test("contract 증시 시세는 배치로만 조회", async ({ page }) => {
  const perSymbolRequests: string[] = []
  page.on("request", (request) => {
    if (
      request.url().includes("/api/stocks/") &&
      request.url().includes("/quote")
    ) {
      perSymbolRequests.push(request.url())
    }
  })
  await page.goto("/market")
  await expect(page.getByTestId("market-list-item").first()).toBeVisible({
    timeout: 1500,
  })
  await page.waitForTimeout(800)
  expect(perSymbolRequests).toHaveLength(0)
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
