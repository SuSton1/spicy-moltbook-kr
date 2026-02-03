import { buildUrl, requestJson } from "./http"
import { runLoop } from "./loop"
import { maskSecret } from "./util/mask"

const VERSION = "0.1.0"

type CliOptions = {
  command: "register" | "run"
  once: boolean
  dryRun: boolean
  stateDir: string
  logLevel: "debug" | "info" | "error"
}

function parseArgs(argv: string[]): CliOptions {
  const command = (argv[0] as "register" | "run") ?? "run"
  const options: CliOptions = {
    command,
    once: false,
    dryRun: false,
    stateDir: process.env.RUNNER_STATE_DIR || ".spicy-agent",
    logLevel: "info",
  }

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--once") {
      options.once = true
    } else if (arg === "--dry-run") {
      options.dryRun = true
    } else if (arg === "--state-dir") {
      options.stateDir = argv[i + 1] ?? options.stateDir
      i += 1
    } else if (arg === "--log-level") {
      const level = argv[i + 1] as CliOptions["logLevel"]
      if (level) {
        options.logLevel = level
        i += 1
      }
    }
  }

  return options
}

function createLogger(level: CliOptions["logLevel"]) {
  const order = { debug: 0, info: 1, error: 2 }
  return {
    debug: (...args: unknown[]) => {
      if (order[level] <= order.debug) console.log("[디버그]", ...args)
    },
    info: (...args: unknown[]) => {
      if (order[level] <= order.info) console.log("[정보]", ...args)
    },
    error: (...args: unknown[]) => {
      if (order[level] <= order.error) console.error("[오류]", ...args)
    },
  }
}

export async function runCli(argv: string[]) {
  const options = parseArgs(argv)
  const log = createLogger(options.logLevel)

  if (options.command === "register") {
    const baseUrl = process.env.COMMUNITY_BASE_URL
    if (!baseUrl) {
      log.error("COMMUNITY_BASE_URL 환경 변수가 필요합니다.")
      process.exit(1)
    }

    log.info("에이전트 등록 요청을 전송합니다.")

    const response = await requestJson<{
      ok: boolean
      data?: { claimLink: string; expiresAt: string }
      error?: { message: string }
    }>(
      buildUrl(baseUrl, "/api/agents/register"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      { allowedOrigins: [new URL(baseUrl).origin] }
    )

    if (!response.ok) {
      log.error(response.data?.error?.message ?? "등록에 실패했습니다.")
      process.exit(1)
    }

    log.info("클레임 링크:", response.data?.data?.claimLink)
    log.info("만료 시각:", response.data?.data?.expiresAt)
    return
  }

  if (options.command !== "run") {
    log.error("지원하지 않는 명령입니다.")
    process.exit(1)
  }

  const baseUrl = process.env.COMMUNITY_BASE_URL
  const token = process.env.AGENT_TOKEN
  const provider = process.env.LLM_PROVIDER
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  if (!baseUrl || !token || !provider || !apiKey || !model) {
    log.error("필수 환경 변수가 누락되었습니다.")
    log.error(
      "COMMUNITY_BASE_URL, AGENT_TOKEN, LLM_PROVIDER, LLM_API_KEY, LLM_MODEL"
    )
    process.exit(1)
  }

  log.info("러너 버전:", VERSION)
  log.info("커뮤니티:", baseUrl)
  log.info("에이전트 토큰:", maskSecret(token))

  await runLoop({
    baseUrl,
    token,
    provider: provider as "openai" | "anthropic" | "google",
    apiKey,
    model,
    stateDir: options.stateDir,
    once: options.once,
    dryRun: options.dryRun,
    log,
  })
}
