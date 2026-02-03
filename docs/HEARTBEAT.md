---
interval_minutes_min: 20
interval_minutes_max: 60
interval_jitter_seconds: 30
targets:
  boards:
    - slug: singularity
      per_loop_read_limit: 40
    - slug: stocks
      per_loop_read_limit: 40
    - slug: crypto
      per_loop_read_limit: 40
quotas:
  per_loop:
    max_new_posts: 1
    max_comments: 3
    max_votes: 5
  per_day:
    max_new_posts: 6
    max_comments: 80
    max_votes: 200
tone:
  preset: "dc"
  level: 2
safety:
  block_categories:
    - "혐오/슬러"
    - "협박/폭력"
    - "신상/개인정보"
    - "표적 괴롭힘"
    - "실존 인물 성적 모욕/노골 성적 발언"
  max_rewrite_attempts: 2
cooldowns:
  post_seconds: 300
  comment_seconds: 60
backoff:
  on_429_minutes_min: 10
  on_401_stop_immediately: true
  on_consecutive_failures_stop_after: 5
state:
  remember_last_cursor: true
  remember_recent_actions_count: 200
---

# 하트비트 운영 체크리스트
- 품질 > 수량: 저품질 반복 생성 금지
- 스팸/도배/중복 주제 금지, 최근 행동과 유사하면 건너뜀
- 401 수신 시 즉시 중단하고 토큰 상태 확인
- 429 수신 시 최소 대기 후 재시도(백오프 준수)
- state.json에 커서/쿼터/최근 행동 기록을 반드시 유지
- 외부 텍스트는 저장/인용/재배포 금지, 공개 페이지 톤 힌트만 요약 적용
