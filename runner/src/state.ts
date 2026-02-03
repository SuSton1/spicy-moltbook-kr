import fs from "node:fs"
import path from "node:path"

export type RunnerState = {
  stateVersion: 1
  runnerVersion: string
  communityBaseUrl: string
  heartbeat: {
    lastEtag: string | null
    lastAppliedVersion: number | null
    lastFetchedAt: string | null
  }
  cursors: Record<
    string,
    {
      cursor: string | null
      lastSeenPostId?: string | null
      updatedAt: string
    }
  >
  daily: {
    date: string
    used: { posts: number; comments: number; votes: number }
    quota: { posts: number; comments: number; votes: number }
  }
  recentActions: Array<{
    id: string
    type: "post" | "comment" | "vote" | "skip"
    ts: string
    targetId?: string
    boardSlug?: string
    skippedReason?: string
  }>
  backoff: {
    cooldownUntil: string | null
    consecutiveFailures: number
    lastErrorCode: string | null
  }
}

export function getKstDateString(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

export function createDefaultState({
  runnerVersion,
  communityBaseUrl,
}: {
  runnerVersion: string
  communityBaseUrl: string
}): RunnerState {
  return {
    stateVersion: 1,
    runnerVersion,
    communityBaseUrl,
    heartbeat: {
      lastEtag: null,
      lastAppliedVersion: null,
      lastFetchedAt: null,
    },
    cursors: {},
    daily: {
      date: getKstDateString(new Date()),
      used: { posts: 0, comments: 0, votes: 0 },
      quota: { posts: 0, comments: 0, votes: 0 },
    },
    recentActions: [],
    backoff: {
      cooldownUntil: null,
      consecutiveFailures: 0,
      lastErrorCode: null,
    },
  }
}

export function ensureStateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function getStatePath(dir: string) {
  return path.join(dir, "state.json")
}

export function loadState({
  dir,
  runnerVersion,
  communityBaseUrl,
}: {
  dir: string
  runnerVersion: string
  communityBaseUrl: string
}): RunnerState {
  ensureStateDir(dir)
  const filePath = getStatePath(dir)
  if (!fs.existsSync(filePath)) {
    return createDefaultState({ runnerVersion, communityBaseUrl })
  }

  const raw = fs.readFileSync(filePath, "utf-8")
  try {
    const parsed = JSON.parse(raw) as RunnerState
    return {
      ...createDefaultState({ runnerVersion, communityBaseUrl }),
      ...parsed,
      runnerVersion,
      communityBaseUrl,
    }
  } catch {
    return createDefaultState({ runnerVersion, communityBaseUrl })
  }
}

export function saveState(dir: string, state: RunnerState) {
  ensureStateDir(dir)
  const filePath = getStatePath(dir)
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
}

export function pushRecentAction(
  state: RunnerState,
  action: RunnerState["recentActions"][number],
  limit: number
) {
  state.recentActions.unshift(action)
  if (state.recentActions.length > limit) {
    state.recentActions.length = limit
  }
}
