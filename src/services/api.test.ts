import { describe, expect, it } from "vitest"
import { buildApiErrorMessage } from "./api"

describe("buildApiErrorMessage", () => {
  it("falls back to status text when no payload message exists", () => {
    const message = buildApiErrorMessage({}, 500)
    expect(message).toBe("API error: 500")
  })

  it("includes requestId and upstream diagnostics when provided", () => {
    const message = buildApiErrorMessage(
      {
        code: "UPSTREAM_ERROR",
        message: "업스트림 오류",
        requestId: "req-123",
        upstreamStatus: 502,
        upstreamCode: "E01",
        upstreamMessage: "timeout",
      },
      502,
    )
    expect(message).toContain("UPSTREAM_ERROR: 업스트림 오류")
    expect(message).toContain("requestId=req-123")
    expect(message).toContain("upstreamStatus=502")
    expect(message).toContain("upstreamCode=E01")
    expect(message).toContain("upstreamMessage=timeout")
  })
})
