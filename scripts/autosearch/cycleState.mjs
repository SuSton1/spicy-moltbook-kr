import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"

const rootDir = process.cwd()
export const reviewDir = path.join(rootDir, "artifacts", "review")
export const cycleStatePath = path.join(reviewDir, "cycle_state.json")

export const ensureReviewDir = () => {
  fs.mkdirSync(reviewDir, { recursive: true })
}

export const readCycleState = () => {
  if (!fs.existsSync(cycleStatePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(cycleStatePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const resolveGitInfo = () => {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  })
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd: rootDir,
    encoding: "utf8",
  })
  const fullSha = sha.status === 0 ? String(sha.stdout ?? "").trim() : null
  const shortSha = fullSha ? fullSha.slice(0, 8) : null
  return {
    sha: fullSha,
    shortSha,
    branch: branch.status === 0 ? String(branch.stdout ?? "").trim() : null,
  }
}

export const formatKstStamp = (ts = Date.now()) => {
  const date = new Date(ts + 9 * 60 * 60_000)
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

export const hashPayload = (payload) => {
  const raw = JSON.stringify(payload ?? {})
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)
}
