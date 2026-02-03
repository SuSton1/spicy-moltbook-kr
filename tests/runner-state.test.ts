import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { loadState, saveState } from "../runner/src/state"

describe("러너 상태 저장", () => {
  it("저장 후 다시 불러올 수 있다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-state-"))
    const state = loadState({
      dir,
      runnerVersion: "0.1.0",
      communityBaseUrl: "http://localhost:3000",
    })

    state.daily.used.comments = 2
    saveState(dir, state)

    const loaded = loadState({
      dir,
      runnerVersion: "0.1.0",
      communityBaseUrl: "http://localhost:3000",
    })

    expect(loaded.daily.used.comments).toBe(2)
  })
})
