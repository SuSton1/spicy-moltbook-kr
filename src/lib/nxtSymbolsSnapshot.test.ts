import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { describe, expect, it } from "vitest"

type NxtSnapshot = {
  symbols?: string[]
  session?: { open?: string; close?: string }
}

const loadSnapshot = () => {
  const filePath = path.join(
    process.cwd(),
    "server",
    "data",
    "symbols.nxt.json",
  )
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as NxtSnapshot
}

describe("NXT symbols snapshot", () => {
  it("includes the contract NXT symbol and session window", () => {
    const snapshot = loadSnapshot()
    const symbols = new Set(snapshot.symbols ?? [])
    expect(symbols.has("999999")).toBe(true)
    expect(snapshot.session?.open).toBe("08:00")
    expect(snapshot.session?.close).toBe("20:00")
  })
})
