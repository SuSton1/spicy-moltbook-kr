import { describe, expect, it } from "vitest"
import { parseHeartbeat } from "../runner/src/yaml"

describe("하트비트 파서", () => {
  it("프론트매터와 본문을 분리한다", () => {
    const text = `---
interval_minutes_min: 5
interval_minutes_max: 10
interval_jitter_seconds: 3
targets:
  boards:
    - slug: free
      per_loop_read_limit: 10
quotas:
  per_loop:
    max_new_posts: 1
    max_comments: 2
    max_votes: 3
  per_day:
    max_new_posts: 5
    max_comments: 20
    max_votes: 30
tone:
  preset: dc
  level: 2
safety:
  max_rewrite_attempts: 1
  block_categories: ["a"]
backoff:
  on_429_minutes_min: 10
  on_401_stop_immediately: true
  on_consecutive_failures_stop_after: 3
state:
  remember_last_cursor: true
  remember_recent_actions_count: 50
---
본문 내용
`

    const result = parseHeartbeat(text)
    expect(result.body.trim()).toBe("본문 내용")
    expect(result.config.targets.boards[0]?.slug).toBe("free")
    expect(result.config.quotas.perLoop.maxComments).toBe(2)
    expect(result.config.intervalJitterSeconds).toBe(3)
  })
})
