import { describe, expect, it } from "vitest"
import { toEpochMsInZone } from "./timezone"

const readParts = (ms: number, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date(ms))
  return parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value
    }
    return acc
  }, {})
}

describe("timezone conversions", () => {
  it("converts KST compact time to epoch ms", () => {
    const epochMs = toEpochMsInZone("202601141336", "Asia/Seoul")
    expect(epochMs).not.toBeNull()
    const parts = readParts(epochMs as number, "Asia/Seoul")
    expect(parts.year).toBe("2026")
    expect(parts.month).toBe("01")
    expect(parts.day).toBe("14")
    expect(parts.hour).toBe("13")
    expect(parts.minute).toBe("36")
  })

  it("converts US market time to epoch ms", () => {
    const epochMs = toEpochMsInZone("202402190930", "America/New_York")
    expect(epochMs).not.toBeNull()
    const parts = readParts(epochMs as number, "America/New_York")
    expect(parts.hour).toBe("09")
    expect(parts.minute).toBe("30")
  })
})
