import { parse } from "yaml"

export type HeartbeatConfig = {
  intervalMinutesMin: number
  intervalMinutesMax: number
  intervalJitterSeconds: number
  targets: {
    boards: Array<{ slug: string; perLoopReadLimit: number }>
  }
  quotas: {
    perLoop: { maxNewPosts: number; maxComments: number; maxVotes: number }
    perDay: { maxNewPosts: number; maxComments: number; maxVotes: number }
  }
  tone: { preset: string; level: number }
  safety: { maxRewriteAttempts: number; blockCategories: string[] }
  cooldowns: { postSeconds: number; commentSeconds: number }
  backoff: {
    on429MinutesMin: number
    on401StopImmediately: boolean
    onConsecutiveFailuresStopAfter: number
  }
  state: {
    rememberLastCursor: boolean
    rememberRecentActionsCount: number
  }
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMinutesMin: 5,
  intervalMinutesMax: 20,
  intervalJitterSeconds: 0,
  targets: { boards: [] },
  quotas: {
    perLoop: { maxNewPosts: 0, maxComments: 3, maxVotes: 0 },
    perDay: { maxNewPosts: 0, maxComments: 100, maxVotes: 0 },
  },
  tone: { preset: "dc", level: 1 },
  safety: { maxRewriteAttempts: 2, blockCategories: [] },
  cooldowns: { postSeconds: 300, commentSeconds: 60 },
  backoff: {
    on429MinutesMin: 10,
    on401StopImmediately: true,
    onConsecutiveFailuresStopAfter: 5,
  },
  state: { rememberLastCursor: true, rememberRecentActionsCount: 200 },
}

function normalizeQuota(value: unknown, fallback: HeartbeatConfig["quotas"]["perLoop"]) {
  if (typeof value === "number") {
    return {
      maxNewPosts: Math.min(1, value),
      maxComments: value,
      maxVotes: value,
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return {
      maxNewPosts: Number(record.max_new_posts ?? record.maxNewPosts ?? fallback.maxNewPosts),
      maxComments: Number(record.max_comments ?? record.maxComments ?? fallback.maxComments),
      maxVotes: Number(record.max_votes ?? record.maxVotes ?? fallback.maxVotes),
    }
  }
  return fallback
}

export function parseHeartbeat(text: string) {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith("---")) {
    return { config: DEFAULT_CONFIG, body: text }
  }

  const parts = trimmed.split("---")
  if (parts.length < 3) {
    return { config: DEFAULT_CONFIG, body: text }
  }

  const frontmatter = parts[1]
  const body = parts.slice(2).join("---").trimStart()

  let parsed: Record<string, unknown> = {}
  try {
    parsed = parse(frontmatter) as Record<string, unknown>
  } catch {
    return { config: DEFAULT_CONFIG, body }
  }

  const targets = (parsed.targets as Record<string, unknown>) ?? {}
  const boardsRaw = (targets.boards as Array<Record<string, unknown>>) ?? []
  const boards = boardsRaw
    .filter((board) => typeof board.slug === "string")
    .map((board) => ({
      slug: String(board.slug),
      perLoopReadLimit: Number(board.per_loop_read_limit ?? board.perLoopReadLimit ?? 20),
    }))

  const quotas = (parsed.quotas as Record<string, unknown>) ?? {}

  const perLoop = normalizeQuota(
    quotas.per_loop ?? quotas.perLoop,
    DEFAULT_CONFIG.quotas.perLoop
  )
  const perDay = normalizeQuota(
    quotas.per_day ?? quotas.perDay,
    DEFAULT_CONFIG.quotas.perDay
  )

  const tone = (parsed.tone as Record<string, unknown>) ?? {}
  const safety = (parsed.safety as Record<string, unknown>) ?? {}
  const cooldowns = (parsed.cooldowns as Record<string, unknown>) ?? {}
  const backoff = (parsed.backoff as Record<string, unknown>) ?? {}
  const state = (parsed.state as Record<string, unknown>) ?? {}

  return {
    body,
    config: {
      intervalMinutesMin: Number(parsed.interval_minutes_min ?? DEFAULT_CONFIG.intervalMinutesMin),
      intervalMinutesMax: Number(parsed.interval_minutes_max ?? DEFAULT_CONFIG.intervalMinutesMax),
      intervalJitterSeconds: Number(
        parsed.interval_jitter_seconds ?? DEFAULT_CONFIG.intervalJitterSeconds
      ),
      targets: { boards },
      quotas: { perLoop, perDay },
      tone: {
        preset: String(tone.preset ?? DEFAULT_CONFIG.tone.preset),
        level: Number(tone.level ?? DEFAULT_CONFIG.tone.level),
      },
      safety: {
        maxRewriteAttempts: Number(
          safety.max_rewrite_attempts ?? DEFAULT_CONFIG.safety.maxRewriteAttempts
        ),
        blockCategories: Array.isArray(safety.block_categories)
          ? safety.block_categories.map(String)
          : DEFAULT_CONFIG.safety.blockCategories,
      },
      cooldowns: {
        postSeconds: Number(
          cooldowns.post_seconds ?? DEFAULT_CONFIG.cooldowns.postSeconds
        ),
        commentSeconds: Number(
          cooldowns.comment_seconds ?? DEFAULT_CONFIG.cooldowns.commentSeconds
        ),
      },
      backoff: {
        on429MinutesMin: Number(
          backoff.on_429_minutes_min ?? DEFAULT_CONFIG.backoff.on429MinutesMin
        ),
        on401StopImmediately:
          backoff.on_401_stop_immediately ??
          DEFAULT_CONFIG.backoff.on401StopImmediately,
        onConsecutiveFailuresStopAfter: Number(
          backoff.on_consecutive_failures_stop_after ??
            DEFAULT_CONFIG.backoff.onConsecutiveFailuresStopAfter
        ),
      },
      state: {
        rememberLastCursor:
          state.remember_last_cursor ?? DEFAULT_CONFIG.state.rememberLastCursor,
        rememberRecentActionsCount: Number(
          state.remember_recent_actions_count ??
            DEFAULT_CONFIG.state.rememberRecentActionsCount
        ),
      },
    },
  }
}
