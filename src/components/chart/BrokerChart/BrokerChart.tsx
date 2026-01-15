import { useEffect, useMemo, useRef, useState } from "react"
import type {
  CandlestickData,
  HistogramData,
  LineData,
} from "lightweight-charts"
import {
  INTRADAY_INTERVALS,
  isIntradayInterval,
  resolveIntradayInterval,
} from "../../../lib/chartIntervals"
import { formatTimeLabel } from "../../../lib/format"
import type { SessionWindow } from "../../../lib/session"
import type { Quote } from "../../../services/api"
import { simpleMovingAverage } from "./indicators"
import { createBrokerChartEngine, type BrokerChartEngine } from "./chartEngine"
import { OverlayPanels } from "./overlayPanels"
import type { BrokerCandle, BrokerChartTimeframe } from "./types"
import { resolvePrevClose } from "./types"
import { findNearestCandleAtOrBefore, useChartData } from "./useChartData"

const DAILY_TIMEFRAMES: {
  label: string
  value: BrokerChartTimeframe
  poll: number
}[] = [
  { label: "일봉", value: "1d", poll: 60000 },
  { label: "주봉", value: "1w", poll: 60000 },
  { label: "월봉", value: "1mo", poll: 60000 },
]

const buildCandles = (candles: BrokerCandle[]): CandlestickData[] =>
  candles.map((item) => ({
    time: item.time,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }))

const buildVolumes = (candles: BrokerCandle[]): HistogramData[] =>
  candles.map((item) => ({
    time: item.time,
    value: item.volume,
    color: item.close >= item.open ? "#ff6d6d" : "#4ea7ff",
  }))

const buildMaSeries = (
  candles: BrokerCandle[],
  enabled: { ma5: boolean; ma20: boolean; ma60: boolean; ma120: boolean },
) => {
  const result: { key: keyof typeof enabled; data: LineData[] }[] = []
  if (enabled.ma5) {
    result.push({ key: "ma5", data: simpleMovingAverage(candles, 5) })
  }
  if (enabled.ma20) {
    result.push({ key: "ma20", data: simpleMovingAverage(candles, 20) })
  }
  if (enabled.ma60) {
    result.push({ key: "ma60", data: simpleMovingAverage(candles, 60) })
  }
  if (enabled.ma120) {
    result.push({ key: "ma120", data: simpleMovingAverage(candles, 120) })
  }
  return result
}

export const BrokerChart = ({
  symbol,
  region,
  timeZone,
  quote,
  session,
  name,
}: {
  symbol: string
  region: "KR" | "US"
  timeZone: string
  quote?: Quote | null
  session?: SessionWindow | null
  name?: string
}) => {
  const priceRef = useRef<HTMLDivElement | null>(null)
  const volumeRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<BrokerChartEngine | null>(null)
  const timeZoneRef = useRef(timeZone)
  const fitKeyRef = useRef<string | null>(null)
  const [tf, setTf] = useState<BrokerChartTimeframe>("1d")
  const [showIntervalMenu, setShowIntervalMenu] = useState(false)
  const [showMaMenu, setShowMaMenu] = useState(false)
  const [maEnabled, setMaEnabled] = useState({
    ma5: false,
    ma20: false,
    ma60: false,
    ma120: false,
  })
  const [crosshairActive, setCrosshairActive] = useState(false)
  const crosshairTimeRef = useRef<BrokerCandle["time"] | null>(null)
  const rafRef = useRef<number | null>(null)
  const [crosshairTime, setCrosshairTime] = useState<
    BrokerCandle["time"] | null
  >(null)
  const [visibleRangeLabel, setVisibleRangeLabel] = useState("")

  const intradayInterval = resolveIntradayInterval(
    isIntradayInterval(tf) ? tf : INTRADAY_INTERVALS[0].key,
  )
  const dailyInterval =
    DAILY_TIMEFRAMES.find((item) => item.value === tf) ?? DAILY_TIMEFRAMES[0]
  const pollMs = isIntradayInterval(tf)
    ? intradayInterval.pollMs
    : dailyInterval.poll
  const days = isIntradayInterval(tf) ? 5 : 1
  const viewKey = `${symbol}:${tf}:${days}`

  const chartData = useChartData({
    symbol,
    region,
    tf,
    timeZone,
    pollMs,
    days,
  })

  const candles = chartData.data
  const lastCandle = candles.length ? candles[candles.length - 1] : null
  const prevClose = useMemo(() => {
    const fallback =
      candles.length >= 2 ? candles[candles.length - 2]?.close : null
    return resolvePrevClose(quote, fallback)
  }, [candles, quote])
  const lastPrice =
    (quote?.price ?? 0) > 0
      ? (quote?.price ?? null)
      : (lastCandle?.close ?? null)
  const lastPriceColor =
    typeof lastPrice === "number" &&
    typeof prevClose === "number" &&
    lastPrice - prevClose < 0
      ? "#4ea7ff"
      : "#ff6d6d"

  const candleData = useMemo(() => buildCandles(candles), [candles])
  const volumeData = useMemo(() => buildVolumes(candles), [candles])
  const crosshairLookupItems = useMemo(
    () =>
      candles.map((item) => ({
        time: item.time,
        close: item.close,
        volume: item.volume,
      })),
    [candles],
  )
  const maSeries = useMemo(
    () => buildMaSeries(candles, maEnabled),
    [candles, maEnabled],
  )

  const selectedCandle = useMemo(() => {
    if (!crosshairActive || crosshairTime == null) {
      return lastCandle
    }
    const found = findNearestCandleAtOrBefore(candles, crosshairTime)
    return found ?? lastCandle
  }, [candles, crosshairActive, crosshairTime, lastCandle])

  const rangeLabels = useMemo(() => {
    if (!candles.length) {
      return { first: "-", last: "-" }
    }
    const first = candles[0]
    const last = candles[candles.length - 1]
    return {
      first: formatTimeLabel(first.time, timeZone),
      last: formatTimeLabel(last.time, timeZone),
    }
  }, [candles, timeZone])

  useEffect(() => {
    timeZoneRef.current = timeZone
    engineRef.current?.updateTimeZone(timeZone)
  }, [timeZone])

  useEffect(() => {
    if (!priceRef.current || !volumeRef.current || engineRef.current) {
      return
    }
    const engine = createBrokerChartEngine({
      priceContainer: priceRef.current,
      volumeContainer: volumeRef.current,
      timeZone: timeZoneRef.current,
      onCrosshair: ({ time }) => {
        const active = Boolean(time)
        setCrosshairActive(active)
        crosshairTimeRef.current = time
        if (rafRef.current) {
          return
        }
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null
          setCrosshairTime(crosshairTimeRef.current)
        })
      },
    })
    engineRef.current = engine
    const handleRange = (range: { from: number; to: number } | null) => {
      if (!range) {
        setVisibleRangeLabel("")
        return
      }
      setVisibleRangeLabel(`${Math.round(range.from)}:${Math.round(range.to)}`)
    }
    engine.priceChart
      .timeScale()
      .subscribeVisibleLogicalRangeChange(handleRange)

    const observer = new ResizeObserver(() => {
      engine.resize()
    })
    observer.observe(priceRef.current)
    observer.observe(volumeRef.current)

    return () => {
      observer.disconnect()
      engine.priceChart
        .timeScale()
        .unsubscribeVisibleLogicalRangeChange(handleRange)
      engine.destroy()
      engineRef.current = null
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }
    engine.setCrosshairLookup(crosshairLookupItems)
    engine.candleSeries.setData(candleData)
    engine.volumeSeries.setData(volumeData)
    const syncReady = candleData.length > 0 && volumeData.length > 0
    engine.setSyncReady(syncReady)
    const series = maSeries.reduce<Record<string, LineData[]>>((acc, item) => {
      acc[item.key] = item.data
      return acc
    }, {})
    engine.maSeries.ma5.setData(series.ma5 ?? [])
    engine.maSeries.ma20.setData(series.ma20 ?? [])
    engine.maSeries.ma60.setData(series.ma60 ?? [])
    engine.maSeries.ma120.setData(series.ma120 ?? [])

    engine.setReferenceLines({
      lastPrice,
      prevClose,
      lastPriceColor,
      prevCloseColor: "rgba(199,209,239,0.5)",
    })
    engine.syncScaleWidths()
    if (syncReady && fitKeyRef.current !== viewKey) {
      engine.priceChart.timeScale().fitContent()
      engine.volumeChart.timeScale().fitContent()
      fitKeyRef.current = viewKey
    }
    if (!syncReady) {
      fitKeyRef.current = null
    }
  }, [
    candleData,
    crosshairLookupItems,
    lastPrice,
    lastPriceColor,
    maSeries,
    prevClose,
    viewKey,
    volumeData,
  ])

  const loadingOverlay = chartData.status === "loading" && candles.length === 0
  const candleErrorLabel =
    chartData.status === "error"
      ? `차트 조회 실패${chartData.error ? `: ${chartData.error}` : ""}`
      : ""

  return (
    <div>
      <div className="tf-row broker-chart-toolbar">
        <div className="interval-control">
          <button
            className={isIntradayInterval(tf) ? "active" : ""}
            data-testid="intraday-interval-trigger"
            onClick={() => {
              setShowIntervalMenu((prev) => !prev)
              setShowMaMenu(false)
            }}
            type="button"
          >
            {intradayInterval.label}
          </button>
          {showIntervalMenu && (
            <div className="interval-menu" data-testid="intraday-interval-menu">
              {INTRADAY_INTERVALS.map((item) => (
                <button
                  key={item.key}
                  className={`btn ${tf === item.key ? "active" : ""}`}
                  data-testid={`intraday-interval-option-${item.key}`}
                  onClick={() => {
                    setTf(item.key)
                    setShowIntervalMenu(false)
                    setShowMaMenu(false)
                  }}
                  type="button"
                >
                  {item.key}
                </button>
              ))}
            </div>
          )}
        </div>
        {DAILY_TIMEFRAMES.map((item) => (
          <button
            key={item.value}
            className={tf === item.value ? "active" : ""}
            data-testid={`tf-${item.value}`}
            onClick={() => {
              setTf(item.value)
              setShowIntervalMenu(false)
              setShowMaMenu(false)
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <div className="interval-control">
          <button
            className={Object.values(maEnabled).some(Boolean) ? "active" : ""}
            onClick={() => {
              setShowMaMenu((prev) => !prev)
              setShowIntervalMenu(false)
            }}
            type="button"
          >
            지표
          </button>
          {showMaMenu && (
            <div className="interval-menu" data-testid="ma-menu">
              {(
                [
                  ["ma5", "MA5"],
                  ["ma20", "MA20"],
                  ["ma60", "MA60"],
                  ["ma120", "MA120"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`btn ${maEnabled[key] ? "active" : ""}`}
                  onClick={() =>
                    setMaEnabled((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="broker-chart-shell">
        <OverlayPanels
          symbol={symbol}
          name={name}
          session={session}
          tf={tf}
          timeZone={timeZone}
          crosshairActive={crosshairActive}
          candle={crosshairActive ? selectedCandle : null}
          lastCandle={lastCandle}
          lastPrice={lastPrice}
          prevClose={prevClose}
        />

        <div className="broker-chart-wrap">
          <div
            ref={priceRef}
            className="broker-chart-canvas broker-chart-price"
            data-testid="chart-price-pane"
          />
          <div
            ref={volumeRef}
            className="broker-chart-canvas broker-chart-volume"
            data-testid="chart-volume-pane"
          />

          <div
            className="small-text"
            data-testid="chart-candle-count"
            style={{ display: "none" }}
          >
            {candles.length}
          </div>
          <div
            className="small-text"
            data-testid="chart-visible-range"
            style={{ display: "none" }}
          >
            {visibleRangeLabel}
          </div>
          <div
            className="small-text"
            data-testid="chart-range"
            style={{ display: "none" }}
          >
            {rangeLabels.first} ~ {rangeLabels.last}
          </div>

          {loadingOverlay && (
            <div className="chart-overlay">차트 데이터 로딩 중…</div>
          )}
        </div>
      </div>

      {candleErrorLabel && (
        <div
          className="note-box"
          style={{ marginTop: "12px" }}
          data-testid="chart-error"
        >
          {candleErrorLabel}
        </div>
      )}
    </div>
  )
}
