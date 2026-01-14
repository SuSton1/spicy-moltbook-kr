import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import {
  decodeRankingCursor,
  encodeRankingCursor,
  sortRankingItems,
  type RankingSortDir,
  type RankingSortKey,
} from "./lib/rankings"
import { __setSymbolCacheForTest } from "./lib/symbolCache"
import { paginateSymbols, type SymbolItem } from "./lib/symbols"
import {
  __resetApiCacheForTest,
  __setProxyBaseForTest,
  fetchIndices,
  fetchRankings,
  fetchSymbols,
} from "./services/api"

vi.mock("./services/api", async () => {
  const actual =
    await vi.importActual<typeof import("./services/api")>("./services/api")
  return {
    ...actual,
    fetchIndices: vi.fn(),
    fetchRankings: vi.fn(),
    fetchSymbols: vi.fn(),
  }
})

const mockFetchIndices = vi.mocked(fetchIndices)
const mockFetchRankings = vi.mocked(fetchRankings)
const mockFetchSymbols = vi.mocked(fetchSymbols)

const buildSymbolItems = (count: number): SymbolItem[] =>
  Array.from({ length: count }).map((_, index) => ({
    symbol: String(100000 + index).padStart(6, "0"),
    name: `테스트 ${index + 1}`,
    market: index % 2 === 0 ? "KOSPI" : "KOSDAQ",
    kind: "STOCK",
    status: "LISTED",
    updatedAt: "2024-01-01T00:00:00Z",
  }))

const SYMBOL_DATASET = buildSymbolItems(120)
const MOCK_KR_INDICES = [
  {
    code: "KOSPI",
    name: "코스피",
    price: 2500.12,
    change: 10,
    changeRate: 0.4,
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    code: "KOSDAQ",
    name: "코스닥",
    price: 850.55,
    change: -4,
    changeRate: -0.3,
    updatedAt: "2024-01-01T00:00:00Z",
  },
]
const MOCK_US_INDICES = [
  {
    code: "NASDAQ",
    name: "NASDAQ",
    price: 16234.56,
    change: 123.45,
    changeRate: 0.77,
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    code: "DOWJONES",
    name: "DOW JONES",
    price: 38901.23,
    change: -210.12,
    changeRate: -0.54,
    updatedAt: "2024-01-01T00:00:00Z",
  },
]

const buildRankingItemsForSymbols = (symbols: SymbolItem[]) =>
  symbols.map((item, index) => {
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

const resolveModeSort = (
  mode: string,
  sortKey?: RankingSortKey,
  sortDir?: RankingSortDir,
): { sortKey: RankingSortKey; sortDir: RankingSortDir } => {
  switch (mode) {
    case "turnover":
      return { sortKey: "turnover", sortDir: "desc" as const }
    case "gainers":
      return { sortKey: "changePercent", sortDir: "desc" as const }
    case "losers":
      return { sortKey: "changePercent", sortDir: "asc" as const }
    case "market_cap":
      return { sortKey: "marketCap", sortDir: "desc" as const }
    case "volume":
    default:
      return {
        sortKey: sortKey ?? "volume",
        sortDir: sortDir ?? "desc",
      }
  }
}

const readRankingTotal = () => {
  const attr = screen
    .getByTestId("market-list")
    .getAttribute("data-total-count")
  return Number(attr ?? "0")
}

beforeEach(() => {
  __resetApiCacheForTest()
  __setSymbolCacheForTest([
    { symbol: "005930", name: "삼성전자", market: "KOSPI" },
  ])
  window.localStorage.clear()
  if (!("IntersectionObserver" in window)) {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    })
  }
  mockFetchSymbols.mockReset()
  mockFetchIndices.mockReset()
  mockFetchRankings.mockReset()
  mockFetchIndices.mockImplementation(async (market) => ({
    indices: market === "US" ? MOCK_US_INDICES : MOCK_KR_INDICES,
  }))
  mockFetchRankings.mockImplementation(
    async ({ mode, sortKey, sortDir, limit = 50, cursor }) => {
      const resolved = resolveModeSort(mode, sortKey, sortDir)
      const baseItems = buildRankingItemsForSymbols(SYMBOL_DATASET)
      const sorted = sortRankingItems(
        baseItems,
        resolved.sortKey,
        resolved.sortDir,
      )
      const offset = decodeRankingCursor(cursor)?.offset ?? 0
      const pageItems = sorted.slice(offset, offset + limit)
      const nextOffset = offset + pageItems.length
      const hasMore = nextOffset < sorted.length
      const nextCursor = hasMore
        ? encodeRankingCursor({
            offset: nextOffset,
            sortKey: resolved.sortKey,
            sortDir: resolved.sortDir,
            market: "ALL",
            query: "",
            cacheKey: `test:${resolved.sortKey}:${resolved.sortDir}`,
          })
        : null
      return {
        items: pageItems,
        nextCursor,
        hasMore,
        totalCount: sorted.length,
      }
    },
  )
  mockFetchSymbols.mockImplementation(async ({ cursor, limit }) => {
    const pageSize = limit ?? 20
    const payload = paginateSymbols(SYMBOL_DATASET, cursor ?? null, pageSize)
    return {
      items: payload.items.map(({ symbol, name, market }) => ({
        symbol,
        name,
        market,
      })),
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      totalCount: payload.totalCount,
    }
  })
})

afterEach(() => {
  cleanup()
})

describe("App", () => {
  it("renders home shell", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId("home-shell")).toBeTruthy()
    expect(screen.getAllByText("최대운주식").length).toBeGreaterThan(0)
  })

  it("does not render ranking nav", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId("nav-rankings")).toBeNull()
  })

  it("does not show proxy warning banner by default", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId("api-warning")).toBeNull()
  })

  it("shows proxy warning banner when explicit proxy fails", async () => {
    const actual =
      await vi.importActual<typeof import("./services/api")>("./services/api")
    const originalFetch = globalThis.fetch
    __setProxyBaseForTest("http://proxy.example")
    globalThis.fetch = vi.fn().mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.startsWith("http://proxy.example")) {
        return Promise.reject(new Error("Proxy down"))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, indices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    await actual.fetchIndices("KR")

    await waitFor(() => {
      expect(screen.getByTestId("api-warning")).toBeTruthy()
    })

    __setProxyBaseForTest(null)
    __resetApiCacheForTest()
    if (originalFetch) {
      globalThis.fetch = originalFetch
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).fetch
    }
  })

  const fixtureMode =
    (import.meta.env.DATA_MODE ?? "fixture").toLowerCase() === "fixture"
  ;(fixtureMode ? it : it.skip)("renders fixture indices immediately", () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByTestId("index-kospi-last").textContent).toMatch(/\d/)
    expect(screen.getByTestId("index-kosdaq-last").textContent).toMatch(/\d/)
  })

  it("shows a clickable local search result within 1s", async () => {
    __setSymbolCacheForTest([
      { symbol: "005930", name: "삼성전자", market: "KOSPI" },
      { symbol: "000660", name: "SK하이닉스", market: "KOSPI" },
    ])

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const input = screen.getByTestId("symbol-search-input")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "삼성" } })

    await waitFor(
      () => {
        expect(screen.getByTestId("symbol-search-item")).toBeTruthy()
      },
      { timeout: 1000 },
    )
    expect(screen.getByTestId("symbol-search-item").tagName).toBe("BUTTON")
  })

  it("opens sort menu and changes mode", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    const trigger = screen.getByTestId("market-sort-trigger")
    fireEvent.click(trigger)
    expect(screen.getByTestId("market-sort-menu")).toBeTruthy()

    fireEvent.click(screen.getByTestId("market-sort-option-volume"))
    expect(screen.queryByTestId("market-sort-menu")).toBeNull()
    expect(trigger.textContent).toContain("거래량")
  })

  it("shows more than 5 items and more panel on initial rankings", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(
      () => {
        expect(readRankingTotal()).toBeGreaterThan(5)
      },
      { timeout: 1000 },
    )
    expect(screen.getAllByTestId("market-list-item")[0].tagName).toBe("A")
    expect(screen.getByTestId("market-more-panel")).toBeTruthy()
  })

  it("renders shared search box on market page", () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByTestId("symbol-search-input")).toBeTruthy()
  })

  it("does not render market symbols section", () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.queryByText("시장 종목")).toBeNull()
  })

  it("loads more rankings by appending pages", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(5)
    })

    const firstCount = readRankingTotal()
    const moreButton = screen.getByTestId("market-more-button")
    fireEvent.click(moreButton)

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(firstCount)
    })

    const secondCount = readRankingTotal()
    fireEvent.click(moreButton)

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(secondCount)
    })
  })

  it("requests US rankings without split tabs", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole("button", { name: "해외" }))

    await waitFor(() => {
      expect(mockFetchRankings).toHaveBeenCalled()
    })

    expect(screen.queryByTestId("market-group-nasdaq")).toBeNull()
    expect(screen.queryByTestId("market-group-dowjones")).toBeNull()

    const calls = mockFetchRankings.mock.calls
    const lastCall = calls.length > 0 ? calls[calls.length - 1][0] : undefined
    expect(lastCall?.region).toBe("US")
    expect(lastCall?.mode).toBe("market_cap")
  })

  it("renders US index labels on overseas tab", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole("button", { name: "해외" }))

    await waitFor(() => {
      expect(screen.getByTestId("index-nasdaq")).toBeTruthy()
    })

    expect(screen.getByTestId("index-dowjones")).toBeTruthy()
    expect(screen.queryByText("코스피")).toBeNull()
    expect(screen.queryByText("코스닥")).toBeNull()
  })

  it("keeps loaded list size when switching modes", async () => {
    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(5)
    })

    fireEvent.click(screen.getByTestId("market-more-button"))

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(5)
    })

    const loadedCount = readRankingTotal()
    fireEvent.click(screen.getByTestId("market-sort-trigger"))
    fireEvent.click(screen.getByTestId("market-sort-option-volume"))

    await waitFor(() => {
      expect(readRankingTotal()).toBeGreaterThan(0)
    })
    const volumeCount = readRankingTotal()

    fireEvent.click(screen.getByTestId("market-sort-trigger"))
    fireEvent.click(screen.getByTestId("market-sort-option-market_cap"))

    await waitFor(() => {
      expect(readRankingTotal()).toBe(loadedCount)
    })

    fireEvent.click(screen.getByTestId("market-sort-trigger"))
    fireEvent.click(screen.getByTestId("market-sort-option-volume"))

    await waitFor(() => {
      expect(readRankingTotal()).toBe(volumeCount)
    })
  })

  it("renders index fallback labels when provided", async () => {
    mockFetchIndices.mockResolvedValueOnce({
      indices: [
        {
          code: "KOSPI",
          name: "코스피",
          price: 2500.12,
          change: 10,
          changeRate: 0.4,
          refDate: "2024-01-01",
          isFallback: true,
          updatedAt: "2024-01-01T00:00:00Z",
        },
        {
          code: "KOSDAQ",
          name: "코스닥",
          price: 850.55,
          change: -4,
          changeRate: -0.3,
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("index-kospi-fallback")).toBeTruthy()
    })
  })

  it("shows explicit error labels when indices fail", async () => {
    mockFetchIndices.mockRejectedValueOnce(new Error("CONFIG_ERROR"))

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("index-kospi-status").textContent).toContain(
        "지수 조회 실패",
      )
    })
    expect(screen.getByTestId("index-kospi-last").textContent).not.toBe("--")
  })
})
