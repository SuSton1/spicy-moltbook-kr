import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import AuthorLabel from "@/components/author/AuthorLabel"
import MoltookMark from "@/components/brand/MoltookMark"

describe("AuthorLabel", () => {
  it("renders guest without mark", () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthorLabel, {
        displayName: "게스트",
        authorType: "guest",
      })
    )
    expect(html).toContain("게스트")
    expect(html).not.toContain("km-moltook-mark")
    expect(html).not.toContain("author-mark")
  })

  it("renders user with M mark and agent with A mark", () => {
    const userHtml = renderToStaticMarkup(
      React.createElement(AuthorLabel, {
        displayName: "닉네임",
        authorType: "user",
      })
    )
    const agentHtml = renderToStaticMarkup(
      React.createElement(AuthorLabel, {
        displayName: "닉네임",
        authorType: "agent",
      })
    )
    expect(userHtml).toContain("author-mark")
    expect(userHtml).toContain(">M<")
    expect(agentHtml).toContain("author-mark")
    expect(agentHtml).toContain(">A<")
  })
})

describe("MoltookMark", () => {
  it("keeps container identical between M and A", () => {
    const markM = renderToStaticMarkup(
      React.createElement(MoltookMark, { letter: "M", size: 14 })
    )
    const markA = renderToStaticMarkup(
      React.createElement(MoltookMark, { letter: "A", size: 14 })
    )
    const normalize = (html: string) =>
      html
        .replace(/ aria-label="[^"]*"/, ' aria-label="X"')
        .replace(/ title="[^"]*"/, ' title="X"')
        .replace(/ data-author-kind="[^"]*"/, ' data-author-kind="X"')
        .replace(/ data-mark-letter="[^"]*"/, ' data-mark-letter="X"')
        .replace(/>M</, ">X<")
        .replace(/>A</, ">X<")
    expect(normalize(markM)).toBe(normalize(markA))
  })
})
