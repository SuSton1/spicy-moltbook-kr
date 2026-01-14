import { memo, useEffect, useMemo, useRef } from "react"
import {
  createChart,
  type CandlestickData,
  type HistogramData,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts"
import {
  type Candle,
  calcCci,
  calcIchimoku,
  calcMacd,
  calcObv,
  calcSupportResistance,
  calcTrendLine,
  calcVolumeProfile,
  detectConvergence,
  simpleMovingAverage,
} from "../lib/indicators"
import { formatNumber, formatTimeLabel } from "../lib/format"
import { perfMark } from "../lib/perf"
import { toEpochMsInZone } from "../lib/timezone"

export type IndicatorState = {
  macd: boolean
  cci: boolean
  obv: boolean
  ichimoku: boolean
  supportResistance: boolean
  trendLine: boolean
  channel: boolean
  convergence: boolean
  volumeProfile: boolean
}

type StockChartProps = {
  candles: Candle[]
  loading?: boolean
  indicators: IndicatorState
  perfKey?: string
  timeZone?: string
}

type SeriesGroup = {
  candle?: ISeriesApi<"Candlestick">
  volume?: ISeriesApi<"Histogram">
  ma5?: ISeriesApi<"Line">
  ma20?: ISeriesApi<"Line">
  ma60?: ISeriesApi<"Line">
  ma120?: ISeriesApi<"Line">
  trend?: ISeriesApi<"Line">
  channelTop?: ISeriesApi<"Line">
  channelBottom?: ISeriesApi<"Line">
  ichimokuConversion?: ISeriesApi<"Line">
  ichimokuBase?: ISeriesApi<"Line">
  ichimokuSpanA?: ISeriesApi<"Line">
  ichimokuSpanB?: ISeriesApi<"Line">
  macd?: ISeriesApi<"Line">
  macdSignal?: ISeriesApi<"Line">
  macdHist?: ISeriesApi<"Histogram">
  cci?: ISeriesApi<"Line">
  obv?: ISeriesApi<"Line">
}

const toTimestamp = (
  time: string | number,
  timeZone?: string,
): UTCTimestamp => {
  if (!time) {
    return 0 as UTCTimestamp
  }
  if (typeof time === "number") {
    const seconds =
      time > 10_000_000_000 ? Math.floor(time / 1000) : Math.floor(time)
    return seconds as UTCTimestamp
  }
  const digits = time.replace(/\D/g, "")
  if (!digits) {
    return 0 as UTCTimestamp
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6)) - 1
  const day = Number(digits.slice(6, 8))
  const hour = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0
  const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0
  if (!timeZone) {
    return Math.floor(
      Date.UTC(year, month, day, hour, minute) / 1000,
    ) as UTCTimestamp
  }
  const epochMs = toEpochMsInZone(digits, timeZone)
  if (!epochMs) {
    return Math.floor(
      Date.UTC(year, month, day, hour, minute) / 1000,
    ) as UTCTimestamp
  }
  return Math.floor(epochMs / 1000) as UTCTimestamp
}

const buildCandles = (candles: Candle[], timeZone?: string) =>
  candles.map(
    (item): CandlestickData => ({
      time: toTimestamp(item.time, timeZone),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }),
  )

const buildVolumes = (candles: Candle[], timeZone?: string) =>
  candles.map(
    (item): HistogramData => ({
      time: toTimestamp(item.time, timeZone),
      value: item.volume,
      color: item.close >= item.open ? "#ff6d6d" : "#4ea7ff",
    }),
  )

const buildLine = (
  points: { time: string | number; value: number }[],
  timeZone?: string,
) =>
  points.map(
    (point): LineData => ({
      time: toTimestamp(point.time, timeZone),
      value: point.value,
    }),
  )

const EMPTY_MACD = { macd: [], signal: [], histogram: [] }
const EMPTY_ICHIMOKU = { conversion: [], base: [], spanA: [], spanB: [] }
const EMPTY_SUPPORT = { highs: [] as number[], lows: [] as number[] }

export const StockChart = memo(function StockChart({
  candles,
  loading,
  indicators,
  perfKey,
  timeZone,
}: StockChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const seriesRef = useRef<SeriesGroup>({})
  const supportLinesRef = useRef<
    ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]
  >([])
  const cciLinesRef = useRef<
    ReturnType<ISeriesApi<"Line">["createPriceLine"]>[]
  >([])

  const candleData = useMemo(
    () => buildCandles(candles, timeZone),
    [candles, timeZone],
  )
  const volumeData = useMemo(
    () => buildVolumes(candles, timeZone),
    [candles, timeZone],
  )
  const ma5 = useMemo(() => simpleMovingAverage(candles, 5), [candles])
  const ma20 = useMemo(() => simpleMovingAverage(candles, 20), [candles])
  const ma60 = useMemo(() => simpleMovingAverage(candles, 60), [candles])
  const ma120 = useMemo(() => simpleMovingAverage(candles, 120), [candles])
  const macd = useMemo(
    () => (indicators.macd ? calcMacd(candles) : EMPTY_MACD),
    [candles, indicators.macd],
  )
  const cci = useMemo(
    () => (indicators.cci ? calcCci(candles) : []),
    [candles, indicators.cci],
  )
  const obv = useMemo(
    () => (indicators.obv ? calcObv(candles) : []),
    [candles, indicators.obv],
  )
  const ichimoku = useMemo(
    () => (indicators.ichimoku ? calcIchimoku(candles) : EMPTY_ICHIMOKU),
    [candles, indicators.ichimoku],
  )
  const trend = useMemo(
    () =>
      indicators.trendLine || indicators.channel
        ? calcTrendLine(candles)
        : null,
    [candles, indicators.channel, indicators.trendLine],
  )
  const support = useMemo(
    () =>
      indicators.supportResistance
        ? calcSupportResistance(candles)
        : EMPTY_SUPPORT,
    [candles, indicators.supportResistance],
  )
  const convergence = useMemo(
    () => (indicators.convergence ? detectConvergence(candles) : false),
    [candles, indicators.convergence],
  )
  const volumeProfile = useMemo(
    () => (indicators.volumeProfile ? calcVolumeProfile(candles) : []),
    [candles, indicators.volumeProfile],
  )

  useEffect(() => {
    if (!chartRef.current) {
      return
    }

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: "#0f1422" },
        textColor: "#c7d1ef",
        fontFamily: "Space Grotesk",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
      },
      crosshair: {
        mode: 1,
      },
      localization: {
        timeFormatter: (time: number) =>
          formatTimeLabel(time as number, timeZone),
      },
    })

    const candle = chart.addCandlestickSeries({
      upColor: "#ff6d6d",
      downColor: "#4ea7ff",
      borderVisible: false,
      wickUpColor: "#ff6d6d",
      wickDownColor: "#4ea7ff",
    })

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } })

    const ma5Series = chart.addLineSeries({ color: "#f5b942", lineWidth: 1 })
    const ma20Series = chart.addLineSeries({ color: "#3f9cff", lineWidth: 1 })
    const ma60Series = chart.addLineSeries({ color: "#b089ff", lineWidth: 1 })
    const ma120Series = chart.addLineSeries({ color: "#2ed4a7", lineWidth: 1 })

    const ichimokuConversion = chart.addLineSeries({
      color: "#f08a5d",
      lineWidth: 1,
    })
    const ichimokuBase = chart.addLineSeries({ color: "#ffcc29", lineWidth: 1 })
    const ichimokuSpanA = chart.addLineSeries({
      color: "#45b7f5",
      lineWidth: 1,
    })
    const ichimokuSpanB = chart.addLineSeries({
      color: "#9b59b6",
      lineWidth: 1,
    })

    const trendLine = chart.addLineSeries({ color: "#f75f5f", lineWidth: 1 })
    const channelTop = chart.addLineSeries({ color: "#ffb347", lineWidth: 1 })
    const channelBottom = chart.addLineSeries({
      color: "#4ea7ff",
      lineWidth: 1,
    })

    seriesRef.current = {
      candle,
      volume,
      ma5: ma5Series,
      ma20: ma20Series,
      ma60: ma60Series,
      ma120: ma120Series,
      ichimokuConversion,
      ichimokuBase,
      ichimokuSpanA,
      ichimokuSpanB,
      trend: trendLine,
      channelTop,
      channelBottom,
    }

    const indicatorChart = indicatorRef.current
      ? createChart(indicatorRef.current, {
          layout: {
            background: { color: "#0f1422" },
            textColor: "#c7d1ef",
            fontFamily: "Space Grotesk",
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.05)" },
            horzLines: { color: "rgba(255,255,255,0.05)" },
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.1)",
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.1)",
          },
        })
      : null

    if (indicatorChart) {
      const macdSeries = indicatorChart.addLineSeries({ color: "#f5b942" })
      const macdSignal = indicatorChart.addLineSeries({ color: "#4ea7ff" })
      const macdHist = indicatorChart.addHistogramSeries({
        priceScaleId: "",
        color: "#2ed4a7",
      })
      const cciSeries = indicatorChart.addLineSeries({ color: "#ff8c42" })
      const obvSeries = indicatorChart.addLineSeries({ color: "#6ee7ff" })
      seriesRef.current = {
        ...seriesRef.current,
        macd: macdSeries,
        macdSignal,
        macdHist,
        cci: cciSeries,
        obv: obvSeries,
      }
      cciLinesRef.current = [
        cciSeries.createPriceLine({
          price: 100,
          color: "#3b82f6",
          lineWidth: 1,
        }),
        cciSeries.createPriceLine({ price: 0, color: "#94a3b8", lineWidth: 1 }),
        cciSeries.createPriceLine({
          price: -100,
          color: "#ef4444",
          lineWidth: 1,
        }),
      ]

      chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (range && indicatorChart) {
          indicatorChart.timeScale().setVisibleRange(range)
        }
      })
      indicatorChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (range && chart) {
          chart.timeScale().setVisibleRange(range)
        }
      })
    }

    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current || !param?.seriesData || !param.time) {
        return
      }
      const candleData = param.seriesData.get(
        seriesRef.current.candle as ISeriesApi<"Candlestick">,
      )
      if (!candleData || typeof candleData !== "object") {
        return
      }
      const data = candleData as CandlestickData
      tooltipRef.current.innerHTML = `
        <div>${formatTimeLabel(param.time as number, timeZone)}</div>
        <div>O ${formatNumber(data.open)} / H ${formatNumber(data.high)}</div>
        <div>L ${formatNumber(data.low)} / C ${formatNumber(data.close)}</div>
      `
    })

    return () => {
      chart.remove()
      indicatorChart?.remove()
    }
  }, [timeZone])

  useEffect(() => {
    const series = seriesRef.current
    if (!series.candle || !series.volume) {
      return
    }
    series.candle.setData(candleData)
    series.volume.setData(volumeData)
    series.ma5?.setData(buildLine(ma5, timeZone))
    series.ma20?.setData(buildLine(ma20, timeZone))
    series.ma60?.setData(buildLine(ma60, timeZone))
    series.ma120?.setData(buildLine(ma120, timeZone))

    series.ichimokuConversion?.setData(buildLine(ichimoku.conversion, timeZone))
    series.ichimokuBase?.setData(buildLine(ichimoku.base, timeZone))
    series.ichimokuSpanA?.setData(buildLine(ichimoku.spanA, timeZone))
    series.ichimokuSpanB?.setData(buildLine(ichimoku.spanB, timeZone))

    series.macd?.setData(buildLine(macd.macd, timeZone))
    series.macdSignal?.setData(buildLine(macd.signal, timeZone))
    series.macdHist?.setData(
      macd.histogram.map((item) => ({
        time: toTimestamp(item.time, timeZone),
        value: item.value,
        color: item.value >= 0 ? "#2ed4a7" : "#ff6d6d",
      })),
    )
    series.cci?.setData(buildLine(cci, timeZone))
    series.obv?.setData(buildLine(obv, timeZone))

    series.ma5?.applyOptions({ visible: true })
    series.ma20?.applyOptions({ visible: true })
    series.ma60?.applyOptions({ visible: true })
    series.ma120?.applyOptions({ visible: true })

    series.ichimokuConversion?.applyOptions({ visible: indicators.ichimoku })
    series.ichimokuBase?.applyOptions({ visible: indicators.ichimoku })
    series.ichimokuSpanA?.applyOptions({ visible: indicators.ichimoku })
    series.ichimokuSpanB?.applyOptions({ visible: indicators.ichimoku })

    series.macd?.applyOptions({ visible: indicators.macd })
    series.macdSignal?.applyOptions({ visible: indicators.macd })
    series.macdHist?.applyOptions({ visible: indicators.macd })
    series.cci?.applyOptions({ visible: indicators.cci })
    series.obv?.applyOptions({ visible: indicators.obv })

    if (trend && indicators.trendLine) {
      series.trend?.setData(buildLine([trend.start, trend.end], timeZone))
    } else {
      series.trend?.setData([])
    }

    if (trend && indicators.channel) {
      const offset = Math.abs(trend.slope) * 6 + 30
      series.channelTop?.setData(
        buildLine(
          [
            { ...trend.start, value: trend.start.value + offset },
            { ...trend.end, value: trend.end.value + offset },
          ],
          timeZone,
        ),
      )
      series.channelBottom?.setData(
        buildLine(
          [
            { ...trend.start, value: trend.start.value - offset },
            { ...trend.end, value: trend.end.value - offset },
          ],
          timeZone,
        ),
      )
    } else {
      series.channelTop?.setData([])
      series.channelBottom?.setData([])
    }

    supportLinesRef.current.forEach((line) => {
      series.candle?.removePriceLine(line)
    })
    supportLinesRef.current = []

    if (indicators.supportResistance) {
      support.highs.forEach((value) => {
        if (series.candle) {
          supportLinesRef.current.push(
            series.candle.createPriceLine({
              price: value,
              color: "#f97316",
              lineWidth: 1,
            }),
          )
        }
      })
      support.lows.forEach((value) => {
        if (series.candle) {
          supportLinesRef.current.push(
            series.candle.createPriceLine({
              price: value,
              color: "#38bdf8",
              lineWidth: 1,
            }),
          )
        }
      })
    }
    if (perfKey) {
      requestAnimationFrame(() => perfMark(perfKey, "paint", true))
    }
  }, [
    candleData,
    volumeData,
    indicators,
    ma5,
    ma20,
    ma60,
    ma120,
    macd,
    cci,
    obv,
    ichimoku,
    trend,
    support,
    perfKey,
    timeZone,
  ])

  const showIndicatorPanel = indicators.macd || indicators.cci || indicators.obv
  const rangeLabels = useMemo(() => {
    if (candles.length === 0) {
      return { first: "-", last: "-" }
    }
    const first = candles[0]
    const last = candles[candles.length - 1]
    const firstTs = toTimestamp(first.time, timeZone)
    const lastTs = toTimestamp(last.time, timeZone)
    return {
      first: formatTimeLabel(firstTs, timeZone),
      last: formatTimeLabel(lastTs, timeZone),
    }
  }, [candles, timeZone])

  return (
    <div className="chart-wrap">
      <div ref={chartRef} className="chart-canvas" />
      <div className="chart-tooltip" ref={tooltipRef} />
      <div className="small-text" data-testid="chart-candle-count">
        {candles.length}
      </div>
      <div
        className="small-text"
        data-testid="chart-range"
        style={{ display: "none" }}
      >
        {rangeLabels.first} ~ {rangeLabels.last}
      </div>
      {loading && <div className="chart-overlay">차트 데이터 로딩 중…</div>}
      {showIndicatorPanel && (
        <div ref={indicatorRef} className="chart-indicator" />
      )}
      {indicators.volumeProfile && volumeProfile.length > 0 && (
        <div className="card soft" style={{ marginTop: "12px" }}>
          <div className="section-title">매물대</div>
          <div className="list" style={{ marginTop: "8px" }}>
            {volumeProfile.map((item) => (
              <div key={item.price} className="card-row">
                <span>{formatNumber(item.price)}</span>
                <span>{formatNumber(item.volume)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {indicators.convergence && convergence && (
        <div className="note-box" style={{ marginTop: "12px" }}>
          수렴 패턴 감지됨 (최근 고점 하락, 저점 상승)
        </div>
      )}
    </div>
  )
})
