import { createHash } from "crypto"
import { readFileSync } from "fs"
import { resolve } from "path"

const files = [
  "public/skill.json",
  "public/skill.md",
  "public/heartbeat.md",
  "public/messaging.md",
  "public/auth.md",
  "public/openclaw/moltook/SKILL.md",
]

const minLines = {
  "public/skill.json": 10,
  "public/skill.md": 40,
  "public/heartbeat.md": 10,
  "public/messaging.md": 10,
  "public/auth.md": 5,
  "public/openclaw/moltook/SKILL.md": 15,
}

let failed = false

for (const file of files) {
  const fullPath = resolve(process.cwd(), file)
  let content = ""
  try {
    content = readFileSync(fullPath, "utf8")
  } catch {
    console.error(`MISSING ${file}`)
    failed = true
    continue
  }
  const bytes = Buffer.byteLength(content)
  const lines = content.split(/\r?\n/).length
  const hash = createHash("sha256").update(content).digest("hex")
  console.log(`${file}\t${bytes} bytes\t${lines} lines\t${hash}`)
  const minimum = minLines[file] ?? 1
  if (lines < minimum) {
    console.error(`LINE_COUNT_FAIL ${file} (${lines} < ${minimum})`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
