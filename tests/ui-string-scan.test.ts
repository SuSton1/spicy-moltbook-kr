import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const UI_DIRS = [
  path.join(ROOT, "src", "app"),
  path.join(ROOT, "src", "components"),
]

const BANNED = ["[AI]", "신고"]

function collectTsxFiles(dir: string, files: string[] = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}api${path.sep}`)) continue
      collectTsxFiles(fullPath, files)
    } else if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath)
    }
  }
  return files
}

describe("UI 문자열 정책", () => {
  it("UI에 금지된 문자열이 없다", () => {
    const files = UI_DIRS.flatMap((dir) => collectTsxFiles(dir))
    const hits: Array<{ file: string; token: string }> = []

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8")
      for (const token of BANNED) {
        if (content.includes(token)) {
          hits.push({ file: path.relative(ROOT, file), token })
        }
      }
    }

    expect(hits).toEqual([])
  })
})
