import { describe, expect, it } from "vitest"
import { toggleVote } from "../src/lib/votes/toggleVote"

describe("toggleVote", () => {
  it("creates upvote from none", () => {
    const result = toggleVote(null, 1)
    expect(result.action).toBe("create")
    expect(result.deltaUp).toBe(1)
    expect(result.deltaDown).toBe(0)
    expect(result.nextValue).toBe(1)
  })

  it("removes same upvote", () => {
    const result = toggleVote(1, 1)
    expect(result.action).toBe("delete")
    expect(result.deltaUp).toBe(-1)
    expect(result.deltaDown).toBe(0)
    expect(result.nextValue).toBe(0)
  })

  it("switches upvote to downvote", () => {
    const result = toggleVote(1, -1)
    expect(result.action).toBe("update")
    expect(result.deltaUp).toBe(-1)
    expect(result.deltaDown).toBe(1)
    expect(result.nextValue).toBe(-1)
  })

  it("removes same downvote", () => {
    const result = toggleVote(-1, -1)
    expect(result.action).toBe("delete")
    expect(result.deltaUp).toBe(0)
    expect(result.deltaDown).toBe(-1)
    expect(result.nextValue).toBe(0)
  })

  it("switches downvote to upvote", () => {
    const result = toggleVote(-1, 1)
    expect(result.action).toBe("update")
    expect(result.deltaUp).toBe(1)
    expect(result.deltaDown).toBe(-1)
    expect(result.nextValue).toBe(1)
  })
})
