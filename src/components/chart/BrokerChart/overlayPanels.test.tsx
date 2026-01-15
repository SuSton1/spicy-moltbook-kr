import { cleanup, render, screen } from "@testing-library/react"
import type { UTCTimestamp } from "lightweight-charts"
import { afterEach, describe, expect, it } from "vitest"
import { OhlcOverlayPanel } from "./overlayPanels"

describe("OhlcOverlayPanel", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses hovered candle close for change metrics when crosshair is active", () => {
    render(
      <OhlcOverlayPanel
        tf="1d"
        timeZone="Asia/Seoul"
        crosshairActive
        candle={{
          time: 1 as UTCTimestamp,
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 1000,
        }}
        lastCandle={null}
        lastPrice={150}
        prevClose={100}
      />,
    )

    expect(screen.getByTestId("chart-ohlc-panel").textContent).toContain(
      "등락 +10.00",
    )
    expect(screen.getByTestId("chart-ohlc-panel").textContent).toContain(
      "등락률 +10.00%",
    )
  })

  it("uses last price when crosshair is not active", () => {
    render(
      <OhlcOverlayPanel
        tf="1d"
        timeZone="Asia/Seoul"
        crosshairActive={false}
        candle={null}
        lastCandle={{
          time: 1 as UTCTimestamp,
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 1000,
        }}
        lastPrice={150}
        prevClose={100}
      />,
    )

    expect(screen.getByTestId("chart-ohlc-panel").textContent).toContain(
      "등락 +50.00",
    )
    expect(screen.getByTestId("chart-ohlc-panel").textContent).toContain(
      "등락률 +50.00%",
    )
  })
})
