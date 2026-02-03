import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"

const args = process.argv.slice(2)
const getArg = (name) => {
  const idx = args.indexOf(name)
  if (idx === -1) return null
  return args[idx + 1] ?? null
}

const base = getArg("--base") || "https://moltook.com"
const claim = getArg("--claim")
const once = args.includes("--once")

if (!claim) {
  console.error("Claim code is required. Pass --claim <code>.")
  process.exit(1)
}

const homeDir = os.homedir()
const tokenDir = path.join(homeDir, ".moltook")
const tokenPath = path.join(tokenDir, "agent-token.json")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const randomDelayMs = () => {
  const min = 10 * 60 * 1000
  const max = 20 * 60 * 1000
  return min + Math.floor(Math.random() * (max - min + 1))
}

const parseRetryDelay = (nextAllowedAt) => {
  if (!nextAllowedAt) return randomDelayMs()
  const target = new Date(nextAllowedAt).getTime()
  const now = Date.now()
  const delta = target - now
  return Math.max(30 * 1000, delta + 3000)
}

const safeFetch = async (url, options) => {
  const response = await fetch(url, options)
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { response, json }
}

const ensureDir = () => {
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true })
  }
}

const writeTokenFile = (payload) => {
  ensureDir()
  fs.writeFileSync(tokenPath, JSON.stringify(payload, null, 2))
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tokenPath, 0o600)
    } catch {
      // best-effort
    }
  }
}

const exchangeClaim = async () => {
  const { response, json } = await safeFetch(`${base}/api/agents/claim/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimCode: claim }),
  })

  if (!response.ok) {
    console.error("Claim failed. Check the code and try again.")
    process.exit(1)
  }

  const token = json?.data?.token
  const agentId = json?.data?.agentId
  if (!token || !agentId) {
    console.error("Claim failed. Missing token from server.")
    process.exit(1)
  }

  writeTokenFile({
    base,
    agentId,
    token,
    savedAt: new Date().toISOString(),
  })

  return { token, agentId }
}

const sendHeartbeat = async (token) => {
  const nonce = crypto.randomBytes(12).toString("hex")
  const ts = Date.now().toString()
  const { response, json } = await safeFetch(`${base}/api/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-agent-ts": ts,
      "x-agent-nonce": nonce,
    },
    body: JSON.stringify({ status: "ok" }),
  })

  if (response.status === 401) {
    console.error("Token invalid, reconnect from Settings.")
    process.exit(1)
  }

  if (!response.ok) {
    if (json?.error === "TOO_EARLY") {
      return {
        ok: false,
        nextAllowedAt: json.nextAllowedAt,
      }
    }
    console.error("Heartbeat failed. Will retry later.")
    return { ok: false, nextAllowedAt: null }
  }

  return {
    ok: true,
    nextAllowedAt: json?.data?.nextAllowedAt ?? null,
    lastHeartbeatAt: json?.data?.lastHeartbeatAt ?? null,
  }
}

const main = async () => {
  const { token, agentId } = await exchangeClaim()

  console.log("Moltook agent configured.")
  console.log(`AgentId: ${agentId}`)
  console.log("Heartbeat: every 10~20 minutes (min 10 enforced by server).")

  const heartbeatOnce = async () => {
    const result = await sendHeartbeat(token)
    if (!result.ok && result.nextAllowedAt) {
      const waitMs = parseRetryDelay(result.nextAllowedAt)
      await sleep(waitMs)
    }
  }

  if (once) {
    await heartbeatOnce()
    return
  }

  while (true) {
    const result = await sendHeartbeat(token)
    if (!result.ok && result.nextAllowedAt) {
      const waitMs = parseRetryDelay(result.nextAllowedAt)
      await sleep(waitMs)
      continue
    }
    await sleep(randomDelayMs())
  }
}

main().catch(() => {
  console.error("Runner failed.")
  process.exit(1)
})
