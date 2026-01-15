import { isIntradayInterval } from "../../../lib/chartIntervals"
import {
  formatNumber,
  formatSigned,
  formatSignedPercent,
  formatTimeLabel,
} from "../../../lib/format"
import type { SessionWindow } from "../../../lib/session"
import { calcChangeMetrics } from "./types"
import type { BrokerCandle, BrokerChartTimeframe } from "./types"

const formatPanelTime = (
  time: number,
  tf: BrokerChartTimeframe,
  timeZone: string,
) => {
  const full = formatTimeLabel(time, timeZone)
  const [date, hm] = full.split(" ")
  if (isIntradayInterval(tf)) {
    return hm ?? date
  }
  return date ?? full
}

const resolveChangeClass = (value: number) => {
  if (value > 0) {
    return "text-up"
  }
  if (value < 0) {
    return "text-down"
  }
  return "muted"
}

export const OverlayPanels = ({
  symbol,
  name,
  session,
  tf,
  timeZone,
  crosshairActive,
  candle,
  lastCandle,
  lastPrice,
  prevClose,
}: {
  symbol: string
  name?: string
  session?: SessionWindow | null
  tf: BrokerChartTimeframe
  timeZone: string
  crosshairActive: boolean
  candle: BrokerCandle | null
  lastCandle: BrokerCandle | null
  lastPrice: number | null
  prevClose: number | null
}) => {
  const sourceCandle = candle ?? lastCandle
  const ohlc = sourceCandle
    ? {
        time: sourceCandle.time,
        open: sourceCandle.open,
        high: sourceCandle.high,
        low: sourceCandle.low,
        close: sourceCandle.close,
        volume: sourceCandle.volume,
      }
    : null
  const displayPrice =
    crosshairActive && ohlc ? ohlc.close : (lastPrice ?? ohlc?.close ?? null)
  const changeMetrics =
    typeof displayPrice === "number" &&
    typeof prevClose === "number" &&
    prevClose > 0
      ? calcChangeMetrics(displayPrice, prevClose)
      : null
  const changeClass = changeMetrics
    ? resolveChangeClass(changeMetrics.change)
    : "muted"

  return (
    <div className="broker-chart-panels">
      <div className="broker-chart-header">
        <div className="broker-chart-title">
          <strong>{name ?? symbol}</strong>
          <span className="muted">({symbol})</span>
        </div>
        <div className="pill-row">
          {session?.label && <span className="pill">{session.label}</span>}
          <span className={`pill ${crosshairActive ? "active" : ""}`}>
            {crosshairActive ? "크로스헤어" : "현재가"}
          </span>
        </div>
      </div>

      <div className="broker-chart-ohlc" data-testid="chart-ohlc-panel">
        <div className="broker-chart-ohlc-row">
          <span className="muted">
            {ohlc ? formatPanelTime(ohlc.time, tf, timeZone) : "-"}
          </span>
          {changeMetrics && (
            <span className={changeClass}>
              {formatSigned(changeMetrics.change)} (
              {formatSignedPercent(changeMetrics.changeRate)})
            </span>
          )}
        </div>
        <div className="broker-chart-ohlc-grid">
          <span className="muted">O</span>
          <span>{ohlc ? formatNumber(ohlc.open) : "-"}</span>
          <span className="muted">H</span>
          <span>{ohlc ? formatNumber(ohlc.high) : "-"}</span>
          <span className="muted">L</span>
          <span>{ohlc ? formatNumber(ohlc.low) : "-"}</span>
          <span className="muted">C</span>
          <span>{ohlc ? formatNumber(ohlc.close) : "-"}</span>
          <span className="muted">V</span>
          <span>{ohlc ? formatNumber(ohlc.volume) : "-"}</span>
        </div>
      </div>
    </div>
  )
}
