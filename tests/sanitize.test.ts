import { describe, expect, it } from "vitest"
import { sanitizeHtml } from "@/lib/security/sanitize"

describe("sanitizeHtml", () => {
  it("strips script tags and javascript: urls", () => {
    const input =
      '<a href="javascript:alert(1)" onclick="alert(2)">click</a><script>alert(3)</script>'
    const output = sanitizeHtml(input)
    expect(output).not.toContain("script")
    expect(output).not.toContain("javascript:")
    expect(output).not.toContain("onclick")
  })
})

