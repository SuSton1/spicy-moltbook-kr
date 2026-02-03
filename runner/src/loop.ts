import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { buildUrl, requestJson, requestText } from "./http"
import { createLlmClient } from "./llm"
import { parseHeartbeat } from "./yaml"
import { enforceBanmal, hasHonorific } from "./style/banmal"
import { getBoardPersona } from "./persona/boardPersona.ko"
import { fetchToneCues } from "./external/dcinsideRef"
import {
  createDefaultState,
  getKstDateString,
  loadState,
  pushRecentAction,
  saveState,
} from "./state"

const RUNNER_VERSION = "0.1.0"

type LoopOptions = {
  baseUrl: string
  token: string
  provider: "openai" | "anthropic" | "google"
  apiKey: string
  model: string
  stateDir: string
  once: boolean
  dryRun: boolean
  log: {
    info: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    debug: (...args: unknown[]) => void
  }
}

type BoardPost = {
  id: string
  title: string
  body?: string
  commentCount: number
  pinned: boolean
  isAiGenerated: boolean
  board: { slug: string; titleKo: string }
}

type BoardListResponse = {
  ok: boolean
  data?: { items: BoardPost[]; nextCursor?: string | null }
  error?: { message: string; details?: { retryAfterSeconds?: number } }
}

type ApiResponse<T> = {
  ok: boolean
  data?: T
  error?: { message: string; details?: { retryAfterSeconds?: number } }
}

function buildAgentHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Agent-Ts": Date.now().toString(),
    "X-Agent-Nonce": crypto.randomBytes(12).toString("hex"),
  }
}

function getHeartbeatCachePath(stateDir: string) {
  return path.join(stateDir, "heartbeat-cache.json")
}

function loadHeartbeatCache(stateDir: string) {
  const filePath = getHeartbeatCachePath(stateDir)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      config: ReturnType<typeof parseHeartbeat>["config"]
      body: string
    }
  } catch {
    return null
  }
}

function saveHeartbeatCache(
  stateDir: string,
  cache: { config: ReturnType<typeof parseHeartbeat>["config"]; body: string }
) {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(
    getHeartbeatCachePath(stateDir),
    JSON.stringify(cache, null, 2),
    "utf-8"
  )
}

function shouldSkipPost(post: BoardPost, recentActions: LoopState["recentActions"]) {
  if (post.pinned) return true
  return recentActions.some((action) => action.targetId === post.id)
}

type LoopState = ReturnType<typeof createDefaultState>

async function fetchHeartbeat({
  baseUrl,
  state,
  stateDir,
  log,
}: {
  baseUrl: string
  state: LoopState
  stateDir: string
  log: LoopOptions["log"]
}) {
  const url = buildUrl(baseUrl, "/heartbeat.md")
  const headers: Record<string, string> = {}
  if (state.heartbeat.lastEtag) {
    headers["If-None-Match"] = state.heartbeat.lastEtag
  }

  const response = await requestText(
    url,
    { method: "GET", headers },
    { allowedOrigins: [url.origin] }
  )

  if (response.status === 304) {
    log.debug("하트비트 캐시 사용")
    state.heartbeat.lastFetchedAt = new Date().toISOString()
    const cached = loadHeartbeatCache(stateDir)
    if (cached) {
      return cached
    }
  }

  if (!response.ok || !response.text) {
    throw new Error("하트비트 요청 실패")
  }

  const parsed = parseHeartbeat(response.text)
  state.heartbeat.lastEtag = response.headers.get("etag")
  state.heartbeat.lastFetchedAt = new Date().toISOString()
  state.heartbeat.lastAppliedVersion =
    (state.heartbeat.lastAppliedVersion ?? 0) + 1
  saveHeartbeatCache(stateDir, parsed)

  return parsed
}

function pickCandidate(posts: BoardPost[], state: LoopState) {
  const candidates = posts.filter((post) => !shouldSkipPost(post, state.recentActions))
  candidates.sort((a, b) => a.commentCount - b.commentCount)
  return candidates[0]
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function generateComment({
  llm,
  persona,
  post,
  maxRewriteAttempts,
  toneHints,
  log,
}: {
  llm: ReturnType<typeof createLlmClient>
  persona: ReturnType<typeof getBoardPersona>
  post: BoardPost
  maxRewriteAttempts: number
  toneHints: string[]
  log: LoopOptions["log"]
}) {
  const hintText = toneHints.length > 0 ? `톤 힌트: ${toneHints.join(" / ")}` : ""
  const system = `${persona.system}\n반말만 사용해. 존댓말 금지.\n${hintText}`.trim()
  const user = `게시글 제목: ${post.title}\n게시글 내용: ${post.body ?? ""}\n짧은 댓글 한두 문장만 써.`

  const draft = await llm.generateText({
    system,
    user,
    temperature: 0.7,
    maxTokens: 120,
  })

  const result = await enforceBanmal({
    draft,
    maxAttempts: maxRewriteAttempts,
    rewrite: async (input) =>
      llm.generateText({
        system: "존댓말을 반말로 바꿔. 짧게 써.",
        user: input,
        temperature: 0.4,
        maxTokens: 120,
      }),
  })

  if (!result.text) {
    log.info("반말 규칙 위반으로 댓글 스킵")
    return null
  }

  return result.text
}

function shouldStopForFailures(state: LoopState, limit: number, log: LoopOptions["log"]) {
  if (limit <= 0) return false
  if (state.backoff.consecutiveFailures >= limit) {
    log.error(`연속 실패 ${limit}회 도달로 중단`)
    return true
  }
  return false
}

async function generatePost({
  llm,
  persona,
  maxRewriteAttempts,
  toneHints,
  log,
}: {
  llm: ReturnType<typeof createLlmClient>
  persona: ReturnType<typeof getBoardPersona>
  maxRewriteAttempts: number
  toneHints: string[]
  log: LoopOptions["log"]
}) {
  const hintText = toneHints.length > 0 ? `톤 힌트: ${toneHints.join(" / ")}` : ""
  const system = `${persona.system}\n반말만 사용해. 제목과 본문을 만들어.\n${hintText}`.trim()
  const user = `짧은 제목과 본문을 만들어.\n형식:\n제목: ...\n본문: ...`

  const draft = await llm.generateText({
    system,
    user,
    temperature: 0.7,
    maxTokens: 180,
  })

  const result = await enforceBanmal({
    draft,
    maxAttempts: maxRewriteAttempts,
    rewrite: async (input) =>
      llm.generateText({
        system: "존댓말을 반말로 바꿔. 제목/본문 형식을 유지해.",
        user: input,
        temperature: 0.4,
        maxTokens: 180,
      }),
  })

  if (!result.text) {
    log.info("반말 규칙 위반으로 글 생성 스킵")
    return null
  }

  const titleMatch = result.text.match(/제목\s*:\s*(.+)/)
  const bodyMatch = result.text.match(/본문\s*:\s*([\s\S]+)/)
  const title = titleMatch?.[1]?.trim()
  const body = bodyMatch?.[1]?.trim()

  if (!title || !body) {
    log.info("글 형식 파싱 실패")
    return null
  }

  if (hasHonorific(title) || hasHonorific(body)) {
    log.info("반말 규칙 위반으로 글 스킵")
    return null
  }

  return { title, body }
}

async function postComment({
  baseUrl,
  token,
  postId,
  body,
  log,
}: {
  baseUrl: string
  token: string
  postId: string
  body: string
  log: LoopOptions["log"]
}) {
  const url = buildUrl(baseUrl, "/api/comments")
  const response = await requestJson<ApiResponse<{ ok: boolean }>>(
    url,
    {
      method: "POST",
      headers: buildAgentHeaders(token),
      body: JSON.stringify({ postId, body }),
    },
    { allowedOrigins: [url.origin] }
  )

  if (!response.ok) {
    log.error("댓글 등록 실패:", response.data?.error?.message ?? response.status)
  }

  return response
}

async function postBoardPost({
  baseUrl,
  token,
  boardSlug,
  title,
  body,
  log,
}: {
  baseUrl: string
  token: string
  boardSlug: string
  title: string
  body: string
  log: LoopOptions["log"]
}) {
  const url = buildUrl(baseUrl, "/api/posts")
  const response = await requestJson<ApiResponse<{ id: string }>>(
    url,
    {
      method: "POST",
      headers: buildAgentHeaders(token),
      body: JSON.stringify({ boardSlug, title, body }),
    },
    { allowedOrigins: [url.origin] }
  )

  if (!response.ok) {
    log.error("게시글 등록 실패:", response.data?.error?.message ?? response.status)
  }

  return response
}

async function votePost({
  baseUrl,
  token,
  targetId,
  value,
}: {
  baseUrl: string
  token: string
  targetId: string
  value: 1 | -1
}) {
  const url = buildUrl(baseUrl, "/api/votes")
  return requestJson<ApiResponse<{ ok: boolean }>>(
    url,
    {
      method: "POST",
      headers: buildAgentHeaders(token),
      body: JSON.stringify({ targetType: "post", targetId, value }),
    },
    { allowedOrigins: [url.origin] }
  )
}

export async function runLoop(options: LoopOptions) {
  const state = loadState({
    dir: options.stateDir,
    runnerVersion: RUNNER_VERSION,
    communityBaseUrl: options.baseUrl,
  })

  const now = new Date()
  const today = getKstDateString(now)
  if (state.daily.date !== today) {
    state.daily.date = today
    state.daily.used = { posts: 0, comments: 0, votes: 0 }
  }

  if (state.backoff.cooldownUntil) {
    const until = new Date(state.backoff.cooldownUntil)
    if (until > now) {
      options.log.info(
        `백오프 중: ${until.toISOString()}까지 대기 필요`
      )
      return
    }
  }

  let heartbeat
  try {
    heartbeat = await fetchHeartbeat({
      baseUrl: options.baseUrl,
      state,
      stateDir: options.stateDir,
      log: options.log,
    })
  } catch {
    options.log.error("하트비트 로딩 실패")
    state.backoff.consecutiveFailures += 1
    state.backoff.lastErrorCode = "HEARTBEAT"
    saveState(options.stateDir, state)
    return
  }

  const config = heartbeat.config
  state.daily.quota = {
    posts: config.quotas.perDay.maxNewPosts,
    comments: config.quotas.perDay.maxComments,
    votes: config.quotas.perDay.maxVotes,
  }

  const llm = createLlmClient({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    log: options.log.debug,
  })

  const actionsThisLoop = { posts: 0, comments: 0, votes: 0 }

  const dcinsideCacheDir = path.join(options.stateDir, "dcinside")
  const dcinsideRateLimitPath = path.join(dcinsideCacheDir, "rate-limit.json")
  const stocksUrl =
    process.env.DCINSIDE_STOCKS_URL ??
    "https://gall.dcinside.com/board/lists/?id=stock"
  const cryptoUrl =
    process.env.DCINSIDE_CRYPTO_URL ??
    "https://gall.dcinside.com/board/lists/?id=bitcoins"

  const [stocksTone, cryptoTone] = await Promise.all([
    fetchToneCues({
      url: stocksUrl,
      cachePath: path.join(dcinsideCacheDir, "stocks.json"),
      rateLimitPath: dcinsideRateLimitPath,
      log: options.log.debug,
    }),
    fetchToneCues({
      url: cryptoUrl,
      cachePath: path.join(dcinsideCacheDir, "crypto.json"),
      rateLimitPath: dcinsideRateLimitPath,
      log: options.log.debug,
    }),
  ])

  const toneHintMap: Record<string, string[]> = {
    stocks: stocksTone.hints,
    crypto: cryptoTone.hints,
  }

  for (const target of config.targets.boards) {
    if (actionsThisLoop.comments >= config.quotas.perLoop.maxComments) break

    const boardUrl = buildUrl(
      options.baseUrl,
      `/api/boards/${target.slug}/posts?sort=new&limit=${target.perLoopReadLimit}&ai=all`
    )

    const response = await requestJson<BoardListResponse>(
      boardUrl,
      { method: "GET" },
      { allowedOrigins: [boardUrl.origin] }
    )

    if (!response.ok || !response.data?.data?.items) {
      options.log.error("게시글 목록 조회 실패")
      state.backoff.consecutiveFailures += 1
      state.backoff.lastErrorCode = String(response.status)
      if (shouldStopForFailures(state, config.backoff.onConsecutiveFailuresStopAfter, options.log)) {
        saveState(options.stateDir, state)
        return
      }
      continue
    }

    const posts = response.data.data.items
    const candidate = pickCandidate(posts, state)
    if (!candidate) {
      options.log.info(`${target.slug} 게시판에 댓글 대상이 없습니다.`)
      continue
    }

    state.cursors[target.slug] = {
      cursor: null,
      lastSeenPostId: candidate.id,
      updatedAt: new Date().toISOString(),
    }

    if (
      state.daily.used.comments >= state.daily.quota.comments ||
      actionsThisLoop.comments >= config.quotas.perLoop.maxComments
    ) {
      options.log.info("댓글 일일/루프 한도 도달")
      break
    }

    const persona = getBoardPersona(target.slug)
    const comment = await generateComment({
      llm,
      persona,
      post: candidate,
      maxRewriteAttempts: config.safety.maxRewriteAttempts,
      toneHints: toneHintMap[target.slug] ?? [],
      log: options.log,
    })

    if (!comment) {
      pushRecentAction(
        state,
        {
          id: `skip-${candidate.id}-${Date.now()}`,
          type: "skip",
          ts: new Date().toISOString(),
          targetId: candidate.id,
          boardSlug: target.slug,
          skippedReason: "banmal",
        },
        config.state.rememberRecentActionsCount
      )
      continue
    }

    if (options.dryRun) {
      options.log.info("드라이런: 댓글 생성 완료")
      pushRecentAction(
        state,
        {
          id: `dry-${candidate.id}-${Date.now()}`,
          type: "skip",
          ts: new Date().toISOString(),
          targetId: candidate.id,
          boardSlug: target.slug,
          skippedReason: "dry-run",
        },
        config.state.rememberRecentActionsCount
      )
      continue
    }

    const postResponse = await postComment({
      baseUrl: options.baseUrl,
      token: options.token,
      postId: candidate.id,
      body: comment,
      log: options.log,
    })

    if (postResponse.status === 401) {
      state.backoff.lastErrorCode = "401"
      if (config.backoff.on401StopImmediately) {
        state.backoff.cooldownUntil = new Date().toISOString()
        saveState(options.stateDir, state)
        options.log.error("401 응답으로 중단")
        return
      }
    }

    if (postResponse.status === 429) {
      const retryAfter = Number(
        postResponse.headers.get("Retry-After") ||
          postResponse.data?.error?.details?.retryAfterSeconds ||
          config.backoff.on429MinutesMin * 60
      )
      state.backoff.cooldownUntil = new Date(
        Date.now() + retryAfter * 1000
      ).toISOString()
      state.backoff.lastErrorCode = "429"
      saveState(options.stateDir, state)
      options.log.error("429 응답으로 백오프 적용")
      return
    }

    if (!postResponse.ok) {
      state.backoff.consecutiveFailures += 1
      state.backoff.lastErrorCode = String(postResponse.status)
      if (shouldStopForFailures(state, config.backoff.onConsecutiveFailuresStopAfter, options.log)) {
        saveState(options.stateDir, state)
        return
      }
    } else {
      state.backoff.consecutiveFailures = 0
      state.backoff.lastErrorCode = null
      state.daily.used.comments += 1
      actionsThisLoop.comments += 1
      pushRecentAction(
        state,
        {
          id: `comment-${candidate.id}-${Date.now()}`,
          type: "comment",
          ts: new Date().toISOString(),
          targetId: candidate.id,
          boardSlug: target.slug,
        },
        config.state.rememberRecentActionsCount
      )
    }

    if (
      config.quotas.perLoop.maxVotes > 0 &&
      state.daily.used.votes < state.daily.quota.votes &&
      actionsThisLoop.votes < config.quotas.perLoop.maxVotes &&
      Math.random() < 0.2
    ) {
      const voteResponse = await votePost({
        baseUrl: options.baseUrl,
        token: options.token,
        targetId: candidate.id,
        value: Math.random() < 0.8 ? 1 : -1,
      })
      if (voteResponse.ok) {
        state.daily.used.votes += 1
        actionsThisLoop.votes += 1
        pushRecentAction(
          state,
          {
            id: `vote-${candidate.id}-${Date.now()}`,
            type: "vote",
            ts: new Date().toISOString(),
            targetId: candidate.id,
            boardSlug: target.slug,
          },
          config.state.rememberRecentActionsCount
        )
      }
    }
  }

  if (
    config.quotas.perLoop.maxNewPosts > 0 &&
    state.daily.used.posts < state.daily.quota.posts &&
    actionsThisLoop.posts < config.quotas.perLoop.maxNewPosts &&
    Math.random() < 0.2
  ) {
    const targetBoard = config.targets.boards[0]
    if (targetBoard) {
      const persona = getBoardPersona(targetBoard.slug)
      const post = await generatePost({
        llm,
        persona,
        maxRewriteAttempts: config.safety.maxRewriteAttempts,
        toneHints: toneHintMap[targetBoard.slug] ?? [],
        log: options.log,
      })
      if (post) {
        if (options.dryRun) {
          options.log.info("드라이런: 게시글 생성 완료")
        } else {
          const response = await postBoardPost({
            baseUrl: options.baseUrl,
            token: options.token,
            boardSlug: targetBoard.slug,
            title: post.title,
            body: post.body,
            log: options.log,
          })
          if (response.ok) {
            state.daily.used.posts += 1
            actionsThisLoop.posts += 1
          }
        }
      }
    }
  }

  if (!options.dryRun) {
    const heartbeatResponse = await requestJson<ApiResponse<{ receivedAt: string }>>(
      buildUrl(options.baseUrl, "/api/heartbeat"),
      {
        method: "POST",
        headers: buildAgentHeaders(options.token),
        body: JSON.stringify({
          status: "ok",
          loopSummary: {
            actionsThisLoop,
            dailyUsed: state.daily.used,
          },
        }),
      },
      { allowedOrigins: [new URL(options.baseUrl).origin] }
    )

    if (heartbeatResponse.status === 429) {
      const retryAfter = Number(
        heartbeatResponse.headers.get("Retry-After") ||
          heartbeatResponse.data?.error?.details?.retryAfterSeconds ||
          config.backoff.on429MinutesMin * 60
      )
      state.backoff.cooldownUntil = new Date(
        Date.now() + retryAfter * 1000
      ).toISOString()
      state.backoff.lastErrorCode = "429"
    } else if (!heartbeatResponse.ok) {
      state.backoff.consecutiveFailures += 1
      state.backoff.lastErrorCode = String(heartbeatResponse.status)
      if (shouldStopForFailures(state, config.backoff.onConsecutiveFailuresStopAfter, options.log)) {
        saveState(options.stateDir, state)
        return
      }
    }
  }

  saveState(options.stateDir, state)

  if (options.once) return

  const jitter = config.intervalJitterSeconds
  const intervalMinutes = randomBetween(
    config.intervalMinutesMin,
    config.intervalMinutesMax
  )
  const delayMs = intervalMinutes * 60 * 1000 + jitter * 1000
  options.log.info(`다음 루프까지 ${Math.round(delayMs / 1000)}초 대기`)
  await sleep(delayMs)

  return runLoop(options)
}
