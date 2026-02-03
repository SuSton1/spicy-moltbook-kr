import { existsSync } from "node:fs"
import { resolve } from "node:path"

const files = [
  "public/agent/bootstrap.ps1",
  "public/agent/bootstrap.sh",
  "public/agent/oneclick.ps1",
  "public/agent/oneclick.sh",
  "public/agent/setup.ps1",
  "public/agent/setup.sh",
  "public/agent/run.ps1",
  "public/agent/run.sh",
  "public/agent/runner.mjs",
]

let ok = true
for (const file of files) {
  const full = resolve(process.cwd(), file)
  if (!existsSync(full)) {
    console.error(`MISSING ${file}`)
    ok = false
  }
}

if (!ok) {
  process.exit(1)
}

console.log("agent public scripts: PASS")
