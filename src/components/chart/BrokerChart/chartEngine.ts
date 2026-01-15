import {
  CrosshairMode,
  LineStyle,
  createChart,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type TimeChartOptions,
  type UTCTimestamp,
} from "lightweight-charts"
import { formatTimeLabel, numberFormat } from "../../../lib/format"
import type { BrokerChartPane } from "./types"

type CrosshairPayload = {
  pane: BrokerChartPane
  time: UTCTimestamp | null
  price: number | null
  y: number | null
  hasPoint: boolean
}

export type BrokerChartEngine = {
  priceChart: IChartApi
  volumeChart: IChartApi
  candleSeries: ISeriesApi<"Candlestick">
  volumeSeries: ISeriesApi<"Histogram">
  maSeries: ISeriesApi<"Line">[]
  setCrosshairLookup: (
    items: { time: UTCTimestamp; close: number; volume: number }[],
  ) => void
  setSyncReady: (ready: boolean) => void
  destroy: () => void
  resize: () => void
  syncScaleWidths: () => void
  updateTimeZone: (timeZone: string) => void
}

export const createBrokerChartEngine = ({
  priceContainer,
  volumeContainer,
  timeZone,
  onCrosshair,
}: {
  priceContainer: HTMLElement
  volumeContainer: HTMLElement
  timeZone: string
  onCrosshair: (payload: CrosshairPayload) => void
}): BrokerChartEngine => {
  const formatAxisNumber = (value: number) => {
    if (!Number.isFinite(value)) {
      return ""
    }
    return numberFormat.format(value)
  }
  const formatVolumeNumber = (value: number) => {
    if (!Number.isFinite(value)) {
      return ""
    }
    return numberFormat.format(Math.round(value))
  }
  const baseOptions: DeepPartial<TimeChartOptions> = {
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
      rightOffset: 4,
      fixLeftEdge: true,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        style: LineStyle.Dotted,
        width: 1,
        color: "rgba(199,209,239,0.55)",
        labelVisible: true,
      },
      horzLine: {
        style: LineStyle.Dotted,
        width: 1,
        color: "rgba(199,209,239,0.55)",
        labelVisible: false,
      },
    },
    localization: {
      timeFormatter: (time: number) => formatTimeLabel(time, timeZone),
      priceFormatter: formatAxisNumber,
    },
    handleScroll: {
      pressedMouseMove: true,
      mouseWheel: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  }

  const priceChart = createChart(priceContainer, {
    ...baseOptions,
    timeScale: {
      ...baseOptions.timeScale,
      visible: false,
    },
  })
  const volumeChart = createChart(volumeContainer, {
    ...baseOptions,
    crosshair: {
      ...baseOptions.crosshair,
      horzLine: {
        ...baseOptions.crosshair?.horzLine,
        visible: false,
      },
    },
    rightPriceScale: {
      ...baseOptions.rightPriceScale,
      scaleMargins: { top: 0.2, bottom: 0.05 },
    },
    timeScale: {
      ...baseOptions.timeScale,
      visible: true,
      timeVisible: true,
      secondsVisible: false,
    },
  })

  const candleSeries = priceChart.addCandlestickSeries({
    upColor: "#ff6d6d",
    downColor: "#4ea7ff",
    borderVisible: false,
    wickUpColor: "#ff6d6d",
    wickDownColor: "#4ea7ff",
    priceFormat: {
      type: "custom",
      formatter: formatAxisNumber,
    },
  })

  const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat: {
      type: "custom",
      formatter: formatVolumeNumber,
    },
  })

  const maSeries = [
    priceChart.addLineSeries({ color: "#f5b942", lineWidth: 1 }),
    priceChart.addLineSeries({ color: "#ff9f43", lineWidth: 1 }),
    priceChart.addLineSeries({ color: "#3f9cff", lineWidth: 1 }),
    priceChart.addLineSeries({ color: "#b089ff", lineWidth: 1 }),
    priceChart.addLineSeries({ color: "#2ed4a7", lineWidth: 1 }),
  ]

  const rangeSyncing = { active: false }
  let syncingToVolume = false
  let syncingToPrice = false
  let syncReady = false
  let crosshairLookup = {
    closeByTime: new Map<UTCTimestamp, number>(),
    volumeByTime: new Map<UTCTimestamp, number>(),
  }
  let scaleSyncRaf: number | null = null

  const syncScaleWidths = () => {
    if (scaleSyncRaf != null) {
      return
    }
    scaleSyncRaf = window.requestAnimationFrame(() => {
      scaleSyncRaf = null
      const priceWidth = priceChart.priceScale("right").width()
      const volumeWidth = volumeChart.priceScale("right").width()
      const next = Math.max(priceWidth, volumeWidth)
      if (!next) {
        return
      }
      const current = priceChart.priceScale("right").options().minimumWidth
      if (Math.abs(current - next) <= 1) {
        return
      }
      priceChart.applyOptions({ rightPriceScale: { minimumWidth: next } })
      volumeChart.applyOptions({ rightPriceScale: { minimumWidth: next } })
    })
  }

  priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (
      !syncReady ||
      rangeSyncing.active ||
      !range ||
      range.from == null ||
      range.to == null
    ) {
      return
    }
    rangeSyncing.active = true
    try {
      volumeChart.timeScale().setVisibleLogicalRange(range)
    } finally {
      rangeSyncing.active = false
    }
  })

  volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (
      !syncReady ||
      rangeSyncing.active ||
      !range ||
      range.from == null ||
      range.to == null
    ) {
      return
    }
    rangeSyncing.active = true
    try {
      priceChart.timeScale().setVisibleLogicalRange(range)
    } finally {
      rangeSyncing.active = false
    }
  })

  priceChart.subscribeCrosshairMove((param) => {
    if (syncingToPrice && !param.sourceEvent) {
      return
    }
    const hasPoint = Boolean(param.point)
    const time =
      typeof param.time === "number" ? (param.time as UTCTimestamp) : null
    const y = hasPoint ? (param.point?.y ?? null) : null
    const derivedPrice =
      y == null ? null : (candleSeries.coordinateToPrice(y) as number | null)
    const price =
      typeof derivedPrice === "number" && Number.isFinite(derivedPrice)
        ? derivedPrice
        : null
    if (!syncReady) {
      onCrosshair({ pane: "price", time, price, y, hasPoint })
      return
    }
    syncingToVolume = true
    try {
      if (!time) {
        volumeChart.clearCrosshairPosition()
      } else {
        const volumeValue = crosshairLookup.volumeByTime.get(time) ?? 0
        volumeChart.setCrosshairPosition(volumeValue, time, volumeSeries)
      }
    } finally {
      syncingToVolume = false
    }
    onCrosshair({ pane: "price", time, price, y, hasPoint })
  })

  volumeChart.subscribeCrosshairMove((param) => {
    if (syncingToVolume && !param.sourceEvent) {
      return
    }
    const hasPoint = Boolean(param.point)
    const time =
      typeof param.time === "number" ? (param.time as UTCTimestamp) : null
    const closeValue = time ? crosshairLookup.closeByTime.get(time) : undefined
    const derivedY =
      typeof closeValue === "number" && Number.isFinite(closeValue)
        ? candleSeries.priceToCoordinate(closeValue)
        : null
    const y =
      typeof derivedY === "number" && Number.isFinite(derivedY)
        ? derivedY
        : null
    const price =
      typeof closeValue === "number" && Number.isFinite(closeValue)
        ? closeValue
        : null
    if (!syncReady) {
      onCrosshair({ pane: "volume", time, price, y, hasPoint })
      return
    }
    syncingToPrice = true
    try {
      if (!time) {
        priceChart.clearCrosshairPosition()
      } else if (
        typeof closeValue === "number" &&
        Number.isFinite(closeValue)
      ) {
        priceChart.setCrosshairPosition(closeValue, time, candleSeries)
      } else {
        priceChart.clearCrosshairPosition()
      }
    } finally {
      syncingToPrice = false
    }
    onCrosshair({ pane: "volume", time, price, y, hasPoint })
  })

  const resize = () => {
    const priceRect = priceContainer.getBoundingClientRect()
    const volumeRect = volumeContainer.getBoundingClientRect()
    if (priceRect.width && priceRect.height) {
      priceChart.resize(
        Math.floor(priceRect.width),
        Math.floor(priceRect.height),
      )
    }
    if (volumeRect.width && volumeRect.height) {
      volumeChart.resize(
        Math.floor(volumeRect.width),
        Math.floor(volumeRect.height),
      )
    }
    syncScaleWidths()
  }

  const updateTimeZone = (nextTimeZone: string) => {
    priceChart.applyOptions({
      localization: {
        timeFormatter: (time: number) => formatTimeLabel(time, nextTimeZone),
      },
    })
    volumeChart.applyOptions({
      localization: {
        timeFormatter: (time: number) => formatTimeLabel(time, nextTimeZone),
      },
    })
  }

  const destroy = () => {
    if (scaleSyncRaf != null) {
      window.cancelAnimationFrame(scaleSyncRaf)
      scaleSyncRaf = null
    }
    priceChart.remove()
    volumeChart.remove()
  }

  resize()

  return {
    priceChart,
    volumeChart,
    candleSeries,
    volumeSeries,
    maSeries,
    setCrosshairLookup: (items) => {
      crosshairLookup = {
        closeByTime: new Map(items.map((item) => [item.time, item.close])),
        volumeByTime: new Map(items.map((item) => [item.time, item.volume])),
      }
    },
    setSyncReady: (ready) => {
      syncReady = ready
    },
    destroy,
    resize,
    syncScaleWidths,
    updateTimeZone,
  }
}
