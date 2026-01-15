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
  setActivePane: (pane: BrokerChartPane | null) => void
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
        labelVisible: true,
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

  let suppressPriceCrosshair = false
  let suppressVolumeCrosshair = false
  const rangeSyncing = { active: false }
  let syncReady = false
  let activePane: BrokerChartPane | null = "price"
  let crosshairLookup = {
    closeByTime: new Map<UTCTimestamp, number>(),
    volumeByTime: new Map<UTCTimestamp, number>(),
  }
  let scaleSyncRaf: number | null = null

  const applyCrosshairPane = (pane: BrokerChartPane | null) => {
    if (activePane === pane) {
      return
    }
    activePane = pane
    priceChart.applyOptions({
      crosshair: {
        ...baseOptions.crosshair,
        horzLine: {
          ...baseOptions.crosshair?.horzLine,
          visible: pane === "price",
        },
      },
    })
    volumeChart.applyOptions({
      crosshair: {
        ...baseOptions.crosshair,
        horzLine: {
          ...baseOptions.crosshair?.horzLine,
          visible: pane === "volume",
        },
      },
    })
  }

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
    if (suppressPriceCrosshair) {
      suppressPriceCrosshair = false
      return
    }
    const time =
      typeof param.time === "number" ? (param.time as UTCTimestamp) : null
    applyCrosshairPane(time ? "price" : null)
    if (!syncReady) {
      onCrosshair({ pane: "price", time })
      return
    }
    if (!time) {
      suppressVolumeCrosshair = true
      volumeChart.clearCrosshairPosition()
    } else {
      const volumeValue = crosshairLookup.volumeByTime.get(time) ?? 0
      suppressVolumeCrosshair = true
      volumeChart.setCrosshairPosition(volumeValue, time, volumeSeries)
    }
    onCrosshair({ pane: "price", time })
  })

  volumeChart.subscribeCrosshairMove((param) => {
    if (suppressVolumeCrosshair) {
      suppressVolumeCrosshair = false
      return
    }
    const time =
      typeof param.time === "number" ? (param.time as UTCTimestamp) : null
    applyCrosshairPane(time ? "volume" : null)
    if (!syncReady) {
      onCrosshair({ pane: "volume", time })
      return
    }
    if (!time) {
      suppressPriceCrosshair = true
      priceChart.clearCrosshairPosition()
    } else {
      const closeValue = crosshairLookup.closeByTime.get(time) ?? 0
      suppressPriceCrosshair = true
      priceChart.setCrosshairPosition(closeValue, time, candleSeries)
    }
    onCrosshair({ pane: "volume", time })
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
  applyCrosshairPane("price")

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
    setActivePane: applyCrosshairPane,
    updateTimeZone,
  }
}
