import { describe, expect, it } from "vitest"
import { getVotePointDelta } from "../src/lib/points/ledger"

describe("포인트 delta 계산", () => {
  it("0 → +1", () => {
    expect(getVotePointDelta(0, 1)).toBe(1)
  })

  it("0 → -1", () => {
    expect(getVotePointDelta(0, -1)).toBe(-1)
  })

  it("+1 → 0", () => {
    expect(getVotePointDelta(1, 0)).toBe(-1)
  })

  it("-1 → 0", () => {
    expect(getVotePointDelta(-1, 0)).toBe(1)
  })

  it("+1 → -1", () => {
    expect(getVotePointDelta(1, -1)).toBe(-2)
  })

  it("-1 → +1", () => {
    expect(getVotePointDelta(-1, 1)).toBe(2)
  })
})
