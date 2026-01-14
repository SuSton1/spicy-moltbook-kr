import { describe, expect, it } from "vitest"
import { normalizeUsTickerForKis } from "./usSymbols"

describe("normalizeUsTickerForKis", () => {
  it("removes separators for KIS ticker format", () => {
    expect(normalizeUsTickerForKis("BRK.B")).toBe("BRKB")
    expect(normalizeUsTickerForKis(" brk-b ")).toBe("BRKB")
  })
})
