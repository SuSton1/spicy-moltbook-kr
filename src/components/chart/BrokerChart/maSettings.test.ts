import { describe, expect, it } from "vitest"
import {
  DEFAULT_MA_SETTINGS,
  normalizeMaSettings,
  updateMaLine,
} from "./maSettings"

describe("ma settings", () => {
  it("defaults to 5/10/20/60/120 (5 lines)", () => {
    const normalized = normalizeMaSettings(null)
    expect(normalized.lines).toHaveLength(5)
    expect(normalized.lines.map((line) => line.period)).toEqual([
      5, 10, 20, 60, 120,
    ])
    expect(normalized.lines.every((line) => line.enabled)).toBe(true)
  })

  it("normalizes malformed settings by clamping and filling missing lines", () => {
    const normalized = normalizeMaSettings({
      lines: [
        { id: "x", enabled: true, period: -3 },
        { enabled: false, period: 9999 },
      ],
    })
    expect(normalized.lines).toHaveLength(5)
    expect(normalized.lines[0]).toMatchObject({
      id: "x",
      enabled: true,
      period: 1,
    })
    expect(normalized.lines[1]?.period).toBe(500)
    expect(normalized.lines.slice(2).map((line) => line.period)).toEqual(
      DEFAULT_MA_SETTINGS.lines.slice(2).map((line) => line.period),
    )
  })

  it("updates a single MA line with validation", () => {
    const updated = updateMaLine(DEFAULT_MA_SETTINGS, 0, {
      period: 12,
      enabled: false,
    })
    expect(updated.lines[0]?.period).toBe(12)
    expect(updated.lines[0]?.enabled).toBe(false)
    expect(updated.lines[1]?.period).toBe(10)
  })
})
