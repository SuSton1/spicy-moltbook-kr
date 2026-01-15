import { describe, expect, it } from "vitest"
import { coalesceWhileHovering } from "./crosshairState"

describe("coalesceWhileHovering", () => {
  it("keeps previous value while hovering when next is null", () => {
    expect(coalesceWhileHovering(123, null, true)).toBe(123)
  })

  it("clears value when not hovering and next is null", () => {
    expect(coalesceWhileHovering(123, null, false)).toBeNull()
  })

  it("uses next value when provided", () => {
    expect(coalesceWhileHovering(123, 456, true)).toBe(456)
    expect(coalesceWhileHovering(null, 456, false)).toBe(456)
  })
})
