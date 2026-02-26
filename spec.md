# PoolSet-First Hard Spec v2.0

본 문서는 자동 램프업/추천 파이프라인의 단일 진실원천(SSOT)이다. 구현/문서 충돌 시 본 문서가 우선한다.

## A. Hard Nonnegotiables

1. 최상위 정책은 `policyConflictResolution="POOLSET_FIRST_STRICT"`이다.
2. 단일후보 로직과 PoolSet 로직이 충돌하면 PoolSet 로직으로 교체한다.
3. 룰 고정: 진입/청산/포지션/리스크/임계값 `T` 완화 금지.
4. `NO_KIS=1` 고정. 보안 위반/정책 충돌/No-KIS 위반은 즉시 `POLICY_CONFLICT_BLOCKED`.
5. 무거운 실행은 로컬 금지. 서버 또는 Codex Cloud 원격 컨테이너에서만 허용.
6. 구현 완료 선언 금지 조건:
   - `verify` 통과
   - dry-run 통과
   - production-like ramp-up 통과
   - Requirement->Evidence 누락 0건

## B. Hard Conflict Resolution

1. Final PASS 판정 단위는 단일 후보가 아니라 PoolSet이다.
2. Final PASS는 `selectedPoolSetByTrack`의 Stage2(락박스 4개월) 합성 성과만 인정한다.
3. `activationCandidateByTrack`는 호환/진단용으로만 유지하고 최종 판정 근거에서 제외한다.
4. Stage1은 선발 전용, Stage2는 운영 편입 전용으로 고정한다.

## C. Recommendation Split (Hard-Fixed)

1. `INTRADAY_1500` 모드:
   - `GAP_15_BET`만 사용
   - 트랙 최대 1개
   - 유효 후보 없으면 0건 유지
2. `EOD_CLOSE` 모드:
   - `SURGE_EOD`(CORE) + `MOONSHOT`만 사용
   - 판정 시각 `KST 15:30` 고정
   - 트랙 최대 1개
   - `MOONSHOT` 일일 최대 1개
   - 유효 후보 없으면 0건 유지
3. CORE/MOONSHOT 동일 ticker 충돌 시 CORE 우선, MOONSHOT은 다음 후보로 대체.
4. 모드 간 독립성: 15시 경로 실패가 장마감 경로를 막으면 안 된다.

## D. Mandatory Runtime State Machine

```
PRECHECK
-> BUILD_INPUTS
-> GENERATE_ROSTER
-> BUILD_POOLSETS
-> STAGE1_POOLSET_EVAL
-> STAGE2_POOLSET_EVAL
-> POOLSET_MAINTAIN
-> ROUTE_RECOMMEND_1500
-> ROUTE_RECOMMEND_EOD
-> FINALIZE
-> STOP
```

### State Invariants

1. PRECHECK:
   - schema validation pass
   - run lock 획득
   - `NO_KIS=1`
   - policyConflictResolution strict
   - required data minimum 통과
2. BUILD_INPUTS:
   - freshness 유효 또는 1회 복구
3. GENERATE/BUILD:
   - 스카우팅 로스터 확보
   - PoolSet 생성 수/다양성 제약 만족
4. STAGE1/2:
   - Stage1=선발
   - Stage2=최종 게이트
5. ROUTE:
   - 모드별 트랙 강제
   - 트랙별 max1
   - no-match 시 zero 유지 + 이유코드 기록
6. FINALIZE:
   - manifest/postmortem/관측지표 저장

## E. Multi-PoolSet Core Loop (Mandatory Primary Path)

필수 흐름:

`Candidate Bulk -> Stage0/1 Screening -> Scouting Roster -> Multi-PoolSet Build -> Multi-PoolSet Stage1(4m) -> Multi-PoolSet Stage2(4m) -> Recombine -> Repeat`

### 운영 규칙

1. 세션당 여러 PoolSet을 배치 평가한다.
2. `poolsetBatchSize`로 메모리 한도 내 순차 실행한다.
3. Stage2 고비용 평가는 TopK PoolSet만 수행한다.
4. 평가 기준은 일자 단위 라우팅 합성 성과다.
5. 세션 종료 시 상위 PoolSet의 강한 멤버를 추출해 차세대 PoolSet 생성(재조합)한다.
6. 반복 실패 PoolSet은 quarantine TTL로 격리한다.
7. 하위 PoolSet은 drop+refill로 교체한다.
8. 트랙별 `minAlive` 미만 시 자동 리필한다.
9. 보조풀이 아니라 **일자 통과일수 상위 후보 기반 Avengers 루프**를 의무 적용한다.
10. Avengers 루프 규칙:

- Stage1 후보에서 `countWeeksGE` 기반 일자통과 점수(`passDayScore`)로 상위 후보 선별
- 상위 후보로 별도 PoolSet 묶음(DAILY_PASS_AVENGERS) 생성
- 일반 PoolSet과 동일 Stage2 경쟁에 투입
- 상위 결과 멤버 재조합을 `dailyPassRecombineRounds`만큼 반복
- 세션마다 품질 향상 루프를 지속(단발성 보조 평가 금지)

## F. Failure and Recovery Policy

1. 기본 정책: 풀 전체 탈락 금지.
2. 단 하나의 예외:
   - `QUALITY_COLLAPSE + refill failure`에서 트랙 원자 리셋 1회 허용
   - 리셋 1회 후 재실패 시 즉시 다음 세션으로 이월
3. silent fallback 금지, 원인코드 필수 기록.
4. 권장 원인코드:
   - `POOLSET_NO_MATCH`
   - `ALL_FILTERED_BY_TRADABILITY`
   - `DATA_MISSING`
   - `ROUTER_NO_MATCH`
   - `POLICY_CONFLICT_BLOCKED`

## G. Adaptive Capacity Policy (7.8GB Safe)

1. 7.8GB 보호값은 하드 기본값으로 고정.
2. 후보수/PoolSet 수 증감은 수치 게이트로만 허용:
   - 확장 조건: `passDensity` 개선 + `peakRAM` 여유 + `terminalRatio` 안정 동시 만족
   - 축소 조건: `peakRAM` 임계 초과 또는 OOM 위험 감지
3. 축소 우선순위:
   - Stage2 TopK
   - PoolSet 동시평가 수
   - 후보 생성 폭
4. 기본 동시성:
   - `maxWorkers=2`
   - `stage2EvalConcurrency=1`

## H. Data Sync Policy

1. 거래일 1회 동기화 + freshness 부족 시 1회 복구만 허용.
2. 재시도마다 full sync 금지.
3. No-KIS 파이프라인 필수 유지.

## I. Observability and Required Outputs

### KPI (필수)

1. `poolSetAliveByTrack`
2. `poolSetPassRateByTrack`
3. `selectedPoolSetByTrack`
4. `selectedMemberByTrack`
5. `recommendationCountByMode`
6. `emptyReasonByModeAndTrack`

### Recommendation Output Files (필수)

1. `output/recommendations/latest_intraday_1500.json`
2. `output/recommendations/latest_eod_close.json`
3. `output/recommendations/YYYYMMDD_intraday_1500.json`
4. `output/recommendations/YYYYMMDD_eod_close.json`

### Output Metadata (필수)

1. `mode`
2. `track`
3. `poolSetId`
4. `memberCandidateId`
5. `routerScore`
6. `whyCodes`
7. `riskFlags`

## J. Hard Default Config Baseline

1. `policyConflictResolution="POOLSET_FIRST_STRICT"`
2. `poolsetEnabled=true`
3. `poolsetCountByTrack={SURGE_EOD:6,GAP_15_BET:4,MOONSHOT:4}`
4. `poolsetCountMaxByTrack={SURGE_EOD:12,GAP_15_BET:8,MOONSHOT:8}`
5. `poolsetActiveSizeByTrack={SURGE_EOD:5,GAP_15_BET:3,MOONSHOT:2}`
6. `poolsetBenchSizeByTrack={SURGE_EOD:7,GAP_15_BET:5,MOONSHOT:4}`
7. `poolsetMinAliveByTrack={SURGE_EOD:2,GAP_15_BET:2,MOONSHOT:1}`
8. `poolsetRefillCountByTrack={SURGE_EOD:2,GAP_15_BET:2,MOONSHOT:1}`
9. `poolsetStage1WindowMonths=4`
10. `poolsetStage2WindowMonths=4`
11. `poolsetEvalMode="daily_router_8m"`
12. `poolsetBatchSize=2`
13. `stage2TopKByTrack={SURGE_EOD:4,GAP_15_BET:3,MOONSHOT:2}`
14. `dailyPassAvengersEnabled=true`
15. `dailyPassTopNByTrack={SURGE_EOD:48,GAP_15_BET:32,MOONSHOT:24}`
16. `dailyPassPoolsetCountByTrack={SURGE_EOD:2,GAP_15_BET:2,MOONSHOT:1}`
17. `dailyPassRecombineRounds=2`
18. `poolEngineQuotaByTrack={SURGE_EOD:{chart:0.6,rule:0.4},GAP_15_BET:{chart:0.4,rule:0.6},MOONSHOT:{chart:0.5,rule:0.5}}`
19. `routerMode1500Track=["GAP_15_BET"]`
20. `routerModeCloseTrack=["SURGE_EOD","MOONSHOT"]`
21. `routerCloseDecisionTimeKST="15:30"`
22. `maxRecommendationPerTrack=1`
23. `keepZeroWhenNoMatch=true`
24. `moonshotMaxPicksPerDay=1`
25. `moonshotTrackRequiredForCorePass=false`
26. `maxWorkers=2`
27. `stage2EvalConcurrency=1`
28. `dataSyncOncePerTradingDay=true`
29. `dataSyncSkipRetryAttempts=true`
30. `runLockEnabled=true`
31. `maxAttempts=30`
32. `sameFailureLimit=3`
33. `qualityCollapseResetLimit=1`
34. `quarantineTtlByFailureType={STRUCTURAL:86400,QUALITY:43200,TRANSIENT:3600}`
35. `precheckBlockOnSecretFiles=true` (도입 초기 warn-only 가능, 최종 block 전환)

## K. Implementation Order (Hard)

1. `scripts/autosearch/go_live_autosearch.mjs` 판정축 교체/고정
2. `scripts/autosearch/go_live_sharded.mjs` 다중 PoolSet 루프 1급화
3. `scripts/ai-recommend.mjs` 모드 분리 라우터 + max1/zero 유지 + CORE 우선 중복해소
4. `scripts/lib/activeStrategyPolicy.mjs` PoolSet 정규화/선택기/상태 유틸
5. `scripts/lib/patternVersions.mjs` 멤버/PoolSet 캐스케이드 pure 함수
6. `scripts/autosearch/automationCore.mjs` 하드 기본값/충돌 차단
7. `scripts/autosearch/riskClosure.mjs` 키 allowlist/range 검증
8. `scripts/autosearch/status_report.mjs`, `scripts/autosearch/auto_upgrade_loop.mjs` KPI/실패코드 전환
9. `AGENTS.md`, `agent.md` 하드 규약 동기화

## L. Release Gates (All Must Pass)

1. 단일후보 경로가 최종 PASS에 개입하지 않는다.
2. 다중 PoolSet 생성/평가/재조합 루프가 동작한다.
3. 15시 GAP-only, 장마감 CORE+MOONSHOT-only가 동작한다.
4. 모드 독립성 유지.
5. 트랙별 최대 1개/0건 유지가 동작한다.
6. CORE/MOONSHOT ticker 충돌 시 CORE 우선이 동작한다.
7. QUALITY_COLLAPSE 원자 리셋 1회 후 이월이 동작한다.
8. 추천 파일 2모드 산출 + 원인코드 기록이 동작한다.
9. 엔진 쿼터 강제/위반 감지가 동작한다.
10. underflow refill/minAlive 회복이 동작한다.
11. 저메모리(1~2 worker, stage2 concurrency 1) OOM 없이 동작한다.
12. replay 재현성(동일 as-of/config -> 동일 선택) 보장.
13. 실제 램프업 검증 완료.
14. 일자통과 상위 후보 Avengers 루프(생성→Stage2 경쟁→재조합 반복) 동작.
15. Requirement->Evidence 추적표 누락 0건.
16. 한 항목이라도 실패 시 배포 금지.

## Q. Codex Cloud Snapshot Offload (A-Plan)

1. 기본 원칙:
   - 서버 DB 직접 접근 대신 스냅샷 번들(`files.tgz`, 선택 `db.sql.gz`) 기반 실행.
   - 서버는 스냅샷 생성/업로드 전담, Codex Cloud는 계산 실행 전담.
2. 데이터 경로:
   - 서버: `tools/cloud/create_public_snapshot_bundle.sh`
   - 업로드: `tools/cloud/upload_snapshot_bundle.sh` (pre-signed PUT URL)
   - Cloud setup: `tools/cloud/setup_from_snapshot.sh`
   - Cloud run: `tools/cloud/run_rampup_from_snapshot.sh`
3. 보안/정책:
   - setup 단계에서만 URL/secret 사용.
   - 런타임에서는 secret 최소화 + `NO_KIS=1` 고정.
   - KIS 관련 데이터/호출은 snapshot/run 양쪽 모두 금지.
4. 무결성:
   - `SNAPSHOT_SHA256` 검증 권장(불일치 시 즉시 중단).
5. 결과물:
   - autosearch artifacts + recommendation outputs를 Cloud에서 생성/수집.
6. 실패 처리:
   - DB 복구가 필요한 모드에서 DB env/client 누락이면 즉시 실패.
   - reason code와 setup 로그를 postmortem에 포함.

## M. Champion-Discovery Dual Rail

1. Champion Rail:
   - 직전 Stage2 PASS PoolSet을 방어적으로 유지.
   - 품질 하락 시 즉시 제거하지 않고 quarantine/TTL 정책으로 점진 교체.
2. Discovery Rail:
   - 신규 후보 대량 생성 후 Stage0/1 선별을 통과한 로스터로 PoolSet 생성.
   - Daily-pass Avengers 루프를 Discovery 기본 경로로 유지.
3. Stage2 경쟁:
   - Champion + Discovery를 합산하여 TopK Stage2 평가.
   - 승격은 Stage2 PASS PoolSet만 허용.

## N. Requirement->Evidence Contract

1. 각 Requirement ID는 최소 1개 evidence path를 가진다.
2. 산출물: `artifacts/autosearch_automation/_index/requirement_evidence.json`.
3. `missingCount > 0` 이면 verify 실패.
4. 구현 완료 선언 조건:
   - `check:spec-coverage` PASS
   - `check:req-evidence` PASS
   - dry-run + production-like ramp-up PASS

## O. Managed Policy Blocks

1. `spec.md`가 정책 원본(SSOT)이다.
2. `AGENTS.md`/`agent.md`는 managed policy block을 자동 주입한다.
3. 문서 정책 블록 해시 불일치 시 verify 실패.
4. 수동 편집으로 policy block이 깨진 경우 `sync:policy-docs` 후 재검증한다.

## P. Runtime Risk Playbook

1. `WORST2W_BELOW_THRESHOLD`:
   - 트랙 국소 리셋 1회(QUALITY_COLLAPSE 규칙 내)
   - Discovery 비중 상향, Stage2 TopK 재배치
2. `WORST2W_TRACK_ZERO_PASS`:
   - 트랙 토큰 기준 리셋 카운터 분리
   - 동일 트랙 반복 시 carry-over 전환
3. `ROUTER_NO_MATCH` / `POOLSET_NO_MATCH`:
   - PoolSet/Member 캐스케이드 확장
   - 0건 유지 + 원인코드 필수 기록
4. `DATA_MISSING`:
   - 거래일 1회 sync 정책 내에서 1회 복구만 허용
   - 복구 실패 시 STRUCTURAL STOP

## Q. Speed-Only Optimization Contract (Result-Invariant)

1. 본 섹션의 목적은 합격 품질을 바꾸지 않고 실행시간만 단축하는 것이다.
2. PASS/FAIL 판정, 게이트(`T`/LCB/p_lower), 트랙 분리, max1/0건 유지 규칙은 변경 금지다.
3. 허용 최적화는 캐시, 스케줄링, 중복제거, 쿨다운, 관측성 강화로 제한한다.
4. 금지 최적화는 룰/정책/임계값/추천규칙 변경이다.
5. 모든 속도 최적화는 parity(결과 동일성) 검증을 통과해야만 활성 상태로 유지한다.

## R. Stage2 Compute Reuse

1. Stage2 결과 캐시를 사용한다.
2. 캐시 키는 asOf, 윈도우, requiredTracks, passMode, thresholds, member fingerprint/versionLabel, cost model, policy version을 포함한다.
3. 동일 PoolSet 시그니처 중복 평가는 금지한다.
4. cache hit는 계산 재사용만 허용하며 판정식 변경은 금지한다.
5. cache source(`HIT`/`MISS`/`DUPLICATE_REUSE`)를 summary에 기록한다.

## S. Champion-First Scheduler (Latency Reduction)

1. Stage2 큐 우선순위는 Champion -> Discovery -> Recombined 순으로 둔다.
2. required-track PASS가 성립하면 추천 산출을 먼저 기록하고, 남은 Discovery 평가는 continuation으로 수행한다.
3. Discovery 탐색 자체를 끄는 것은 금지하며, 순서 최적화만 허용한다.
4. scheduler reason code(`SCHEDULER_CHAMPION_FIRST`, `CONTINUATION_AFTER_FIRST_PASS`)를 기록한다.

## T. Speed Governor (Lane-Aware)

1. `executionLane=server`에서는 `maxWorkers=2`, `stage2EvalConcurrency=1` 하드락을 유지한다.
2. `executionLane=codex_cloud`에서는 레포 소프트캡을 해제하고(고정 2/1 금지), 플랫폼 한도 내 최대 병렬을 허용한다.
3. 확장 조건은 `passDensity` 개선 + `peakRAM` 여유 + `terminalRatio` 안정을 동시 만족해야 한다.
4. 축소 조건은 RAM 임계 초과 또는 stage2 런타임 급증 감지다.
5. 축소 우선순위는 `stage2TopK -> 동시 PoolSet 평가수 -> 후보 생성폭`이다.
6. speed profile에서 무조건 확장(TopK/PoolsetCount 증가)하는 정책은 금지한다.

## U. Parity Release Gate (Mandatory)

1. 동일 as-of/config replay에서 `selectedPoolSetByTrack` 동일성을 보장해야 한다.
2. cache on/off에서 required-track pass/fail 판정이 동일해야 한다.
3. 모드 분리/추천 규약(1500=GAP, close=SURGE+MOONSHOT, max1/0건, CORE 우선 충돌해소)이 동일해야 한다.
4. `Requirement->Evidence`에 속도 최적화 항목(`R-SPEED-*`, `R-PARITY-*`) 누락이 있으면 verify 실패다.
5. 위 항목 중 1개라도 실패하면 속도 최적화 배포를 금지한다.

## V. Codex Cloud Uncap Policy (Hard)

1. Codex Cloud 램프업은 `executionLane=codex_cloud`로만 실행한다.
2. Codex Cloud에서는 메모리/컴퓨팅 관련 레포 소프트 제한(2 workers, stage2 concurrency=1)을 강제하지 않는다.
3. Codex Cloud에서는 다음 범주를 lane 상한까지 해제한다: `maxParallelShards/maxWorkers`, `poolsetMaxConcurrentEval/stage2EvalConcurrency`, `topPerTrack/shards`, `poolsetCountByTrack/poolsetCountMaxByTrack`, `stage2TopKByTrack`, `dailyPassTopNByTrack`, `dailyPassPoolsetCountByTrack`, `dailyPassRecombineRounds`.
4. 서버 lane(`executionLane=server`)에서는 기존 하드락(`maxWorkers=2`, `stage2EvalConcurrency=1`)을 그대로 유지한다.
5. 단, 플랫폼 하드 제한과 NO_KIS/룰고정/T고정/정책 충돌 차단은 그대로 유지한다.
6. 클라우드 버스트 실행은 `tools/cloud/run_cloud_hyper_burst.sh`를 사용하며, runtime rules 파일(`artifacts/cloud_profiles/rules.runtime.*.json`)로 실행해 git dirty를 유발하지 않는다.
7. 서버 lane과 클라우드 lane 설정이 혼재하면 `POLICY_CONFLICT_BLOCKED`로 즉시 중단한다.

## W. Codex Cloud Continuous Ramp-Up (Immutable Snapshot)

1. 단발 실행이 아니라 연속 램프업은 `tools/cloud/run_cloud_hyper_continuous.sh`를 표준 진입점으로 사용한다.
2. 연속 모드 기본은 immutable data(`--immutable-data=1`)이며, 고정 스냅샷 상태를 유지한다.
3. immutable 모드에서는 데이터 변경성 작업을 금지한다:
   - `dataSyncEnabled=false`
   - `deriveEnabled=false`
   - `forceDataSyncNextAttempt=false`
4. 스냅샷 ID는 `artifacts/cloud_profiles/snapshot_state.json` 또는 `--snapshot-id=<ID>`로 고정한다.
5. immutable 모드에서 snapshot id 불일치/누락 시 즉시 중단한다.
6. 연속 루프는 run lock(`artifacts/cloud_profiles/cloud_hyper_continuous.lock`)을 사용해 중복 실행을 금지한다.
7. 실패 시 백오프를 적용하고 다음 cycle로 자동 재시도한다(무한 재시도 허용, 정책 위반은 즉시 중단).
8. cycle 상태는 `artifacts/cloud_profiles/cloud_hyper_continuous_state.json`에 기록한다.
9. burst/continuous 모두 runtime rules 파일만 생성해 실행하고 tracked rules 파일을 수정하지 않는다.
10. 연속 모드에서도 NO_KIS=1, POOLSET_FIRST_STRICT, Stage2-only final pass 규약은 동일하게 강제된다.
11. `--auto-resource-max=1`(기본)에서는 실행 시점 CPU/RAM을 자동 감지해 `maxWorkers/maxParallelShards/stage2EvalConcurrency/poolsetMaxConcurrentEval/topPerTrack/poolsetCount*`를 상향 조정한다.
12. auto-resource 모드는 고정 상수 상향이 아니라 런타임 자원 기반 상향이며, lane 정책(서버=하드락, codex_cloud=최대 사용)을 우선한다.

## X. Cloud-First Verify And Promote (Hard)

1. 기본 검증 순서는 클라우드 선검증 후 서버 스모크다.
2. 표준 진입점은 `tools/cloud/run_cloud_verify_and_promote.sh`다.
3. 1단계(클라우드): `run_cloud_hyper_burst.sh --verify-once=1`로 verify + burst를 수행한다.
4. 2단계(승격 마커): `artifacts/cloud_profiles/last_cloud_promotion.json`에 승격 이력을 저장한다.
5. 3단계(서버 스모크): `check:agent-sync`, `check:policy-sync`, `check:spec-coverage`, `generate:req-evidence`, `check:req-evidence`만 수행한다.
6. 클라우드 자원 바닥값 검사는 기본 `warn-only`로 운용하고(`--enforce-cloud-resource-floor=0`), 강제 차단이 필요한 배치에서만 `--enforce-cloud-resource-floor=1`로 활성화한다.
7. auto-resource는 감지 자원(CPU/MEM) 기준으로 병렬/후보/PoolSet 관련 값을 직접 재계산해 적용한다(기존 상수 유지 금지).
8. 감지/적용 결과는 `artifacts/cloud_profiles/detected_resources.latest.json`에 저장한다.
9. 서버에서 전체 `npm run verify`는 코드 변경 회귀 확인이 필요할 때만 수행한다.
10. 위 순서에서 하나라도 실패하면 배포/승격을 중단한다.

## Y. Six-Environment Cloud Ramp-Up Contract (Hard)

1. 무거운 작업은 로컬에서 실행하지 않고 Codex Cloud에서만 수행한다.
2. 무거운 작업 범위는 `verify`, 후보 대량 생성, Stage1/Stage2 평가, recombine, 대형 백필/파생 계산 전체다.
3. 서버는 스냅샷 생성/업로드, 실행 오케스트레이션, 결과 병합/보관만 담당한다.
4. 기본 운영 환경은 다음 6개를 모두 사용한다.
   - `spicy-moltbook-kr`
   - `SuSton1/spicy-moltbook-kr-b`
   - `SuSton1/spicy-moltbook-kr-c`
   - `SuSton1/spicy-moltbook-kr-d`
   - `SuSton1/spicy-moltbook-kr-e`
   - `SuSton1/spicy-moltbook-kr-f`
5. 각 환경의 기준 자원은 실측값 `nproc=3`, `mem_total_kb=18801884`, `disk_root_kb=65478188`으로 본다.
6. 6환경 합산 기준 계산 자원은 최소 `18 vCPU`와 `약 107.5GiB RAM`으로 계획한다.
7. 환경 간 작업 중복을 막기 위해 shard lease를 강제한다.
8. shard key는 `runId|track|bucket|seedLane|generation`을 사용한다.
9. idempotency key는 `snapshot_id|asOf|track|poolsetSignature|gateHash|policyHash`를 사용한다.
10. 동일 shard 또는 동일 poolset signature 중복 실행은 금지하고 `DUPLICATE_SHARD_SKIPPED`를 기록한다.
11. 실행 중 장애가 발생하면 글로벌 중단 대신 retry queue로 이월하고 다른 환경이 인수한다.
12. 하드캡 해제는 `executionLane=codex_cloud`에서만 허용한다.
13. 서버 lane은 기존 하드락(`maxWorkers=2`, `stage2EvalConcurrency=1`)을 유지한다.
14. 클라우드 lane 시작값은 고정 상수가 아니라 CPU-primary 동적 계산으로 정한다.
    - `maxWorkers = clamp(cpu, 1, 12)`
    - `maxParallelShards = maxWorkers`
    - `stage2EvalConcurrency = clamp(floor(cpu/2), 1, 2)`
    - `poolsetMaxConcurrentEval = stage2EvalConcurrency`
    - `topPerTrack = clamp(cpu*240 + memGb*30, 400, max(1200, cpu*450))`
    - `poolsetBatchSize = clamp(cpu*2 + memGb/3, 4, cpu*6)`
    - `poolsetCountByTrack`/`poolsetCountMaxByTrack`/`dailyPassTopNByTrack`은 위 값 기반으로만 상향한다.
15. 상향은 `passDensity 개선 + peakRAM 여유 + terminalRatio 안정`을 동시에 만족할 때만 허용한다.
16. 하향은 `swap>0`, `OOM 위험`, `stage2 지연 급증`, `429 반복` 중 하나라도 발생하면 즉시 적용한다.
17. 하향 우선순위는 `stage2TopK -> poolsetBatchSize -> stage2EvalConcurrency -> dailyPassTopN` 순서다.
18. 스냅샷/체크포인트/캐시는 영속 저장소를 사용하며 컨테이너 로컬에 의존하지 않는다.
19. 체크포인트는 300초 간격 및 단계 전환 시 강제 저장한다.
20. cache hit 사용 시 parity 불일치가 발견되면 즉시 cache miss로 강등하고 재계산한다.
21. 6환경 병렬 실행 표준 진입점은 `tools/cloud/run_codex_multi_env_parallel.sh`로 고정한다.
22. 병렬 실행 시 task 등록 파일(`artifacts/cloud_profiles/multi_env_tasks_*.tsv`)과 상태 로그(`artifacts/cloud_profiles/multi_env_status_*.log`)를 필수 생성한다.
23. 각 환경 작업은 `run_cloud_hyper_burst.sh`를 동일 규약으로 실행하고, 환경별 결과는 서버 병합 단계에서만 통합한다.
24. 병렬 실행의 완료 조건은 모든 task가 terminal state(`[READY|COMPLETED|ERROR|FAILED]`)에 도달하는 것이다.
25. `ERROR|FAILED` task가 존재하면 전체 성공으로 간주하지 않고, retry queue로 이월 후 원인코드를 남긴다.
26. 클라우드 검증 기본 프로파일은 `verify:fast`로 사용하고, 최종 승격 전에는 `verify:full`을 수행한다.
27. 6환경 테스트 샤딩 표준 진입점은 `tools/cloud/run_codex_multi_env_test_sharded.sh`다.
28. 테스트 샤딩은 `vitest --shard=i/N` 규약으로 실행하고, shard별 상태를 `artifacts/cloud_profiles/multi_env_test_shards_*.{tsv,log}`에 저장한다.
29. Codex Cloud 환경 생성 시 setup script는 자동 스캔 모드 대신 수동(`bash tools/cloud/setup_minimal.sh`)으로 고정한다.
30. 위 setup 스크립트는 루트 의존성만 설치하고 lock hash가 같으면 `npm ci`를 건너뛴다(깊이 스캔 설치 금지).

## Z. File-Level Hard Patch Directives (Implementation Contract)

1. `scripts/autosearch/go_live_autosearch.mjs`
   - `selectedPoolSetByTrack`는 임시 candidate id가 아니라 입력 PoolSet ID 기반으로 구성한다.
   - `final_report`에 `selectionSource="POOLSET_STAGE2_ONLY"`를 필수 기록한다.
   - `activationCandidateByTrack`는 `diagnostics.activationCandidateByTrack`로만 저장하고 최종 판정 경로에서는 참조 금지 assertion을 강제한다.
2. `scripts/autosearch/go_live_sharded.mjs`
   - Discovery/Champion 이중 레일을 1급 경로로 고정한다.
   - Discovery: 후보 대량생성 -> Stage0/1 -> Scouting Roster -> 신규 PoolSet 생성.
   - Champion: 이전 합격 PoolSet 유지/방어 레일.
   - 두 레일 합산 TopK만 Stage2 고비용 평가한다.
   - `poolSetLineage`(`parentPoolSetIds`, `memberOrigins`)를 summary/manifest에 남긴다.
   - `poolEngineQuotaByTrack` 위반 시 track별 reason code를 강제 기록한다.
   - 확장/축소 의사결정 근거(`passDensity`, `terminalRatio`, `peakRamMb`)를 필수 기록한다.
3. `scripts/ai-recommend.mjs`
   - 모드별 트랙 분리 규칙은 상수 모듈 단일 원천으로 통일한다.
   - 멤버 캐스케이드 + PoolSet 캐스케이드 단계별 실패 reason code를 누적 기록한다.
   - `latest_intraday_1500.json`, `latest_eod_close.json`, 날짜별 2파일을 필수 생성한다.
   - 필수 메타 필드 누락 시 write를 차단한다.
4. `scripts/lib/activeStrategyPolicy.mjs`
   - `poolSetsByTrack` 정규화 시 `passFinal=true` 우선 정렬을 고정한다.
   - 상태 전이 유틸(`ACTIVE/BENCH/QUARANTINED/DROPPED`)을 제공한다.
   - `selectPrimaryPoolSetFromTrack({ requirePassFinal: true })` 옵션을 지원한다.
5. `scripts/lib/patternVersions.mjs`
   - PoolSet/멤버 선택 함수는 pure function으로 유지한다.
   - 랭킹 우선순위는 `regimeMatch > trainRangeValid > deployScore > recency`를 하드 고정한다.
   - 선택 reason code 표준(`POOL_SCORING`, `POOL_EMPTY`, `ROUTER_NO_MATCH`)을 유지한다.
6. `scripts/autosearch/automationCore.mjs`
   - 신규 하드 키 `championDiscoveryBudgetSplit`, `requirementEvidenceEnabled`, `policyDocSyncEnabled`를 기본값과 함께 관리한다.
   - `dataSyncOncePerTradingDay`, `dataSyncSkipRetryAttempts`는 불변 기본값으로 유지한다.
7. `scripts/autosearch/riskClosure.mjs`
   - 신규 키 allowlist/range 검증을 추가한다.
   - `WORST2W_BELOW_THRESHOLD`와 `WORST2W_TRACK_ZERO_PASS`의 트랙 국소 reset 정책을 분리 검증한다.
   - reset limit 초과 시 carry-over를 강제한다.
8. `scripts/autosearch/auto_upgrade_loop.mjs`
   - quality collapse reset scope는 GLOBAL이 아니라 track-local 우선으로 처리한다.
   - attempt별 tuning 재로딩 + 변경 diff를 attempt manifest에 저장한다.
   - 추천 공백은 `POOLSET_NO_MATCH/ROUTER_NO_MATCH/ALL_FILTERED_BY_TRADABILITY/DATA_MISSING` 중 하나를 필수 남긴다.
9. `scripts/autosearch/status_report.mjs`
   - 필수 KPI(`poolSetAliveByTrack`, `poolSetPassRateByTrack`, `selectedPoolSetByTrack`, `selectedMemberByTrack`, `recommendationCountByMode`, `emptyReasonByModeAndTrack`)를 누락 없이 출력한다.
   - `championVsDiscoveryPassShare`를 세션 요약에 포함한다.
10. `tools/check_spec_coverage.mjs`, `tools/check_agent_sync.mjs`
    - 문자열 검사 외 행동 검사 훅(mode split, max1/zero, single-path 배제, 2파일 출력)을 강제한다.
    - `spec.md` 관리 블록 해시와 `AGENTS.md`/`agent.md` 관리 블록 해시를 비교한다.
11. `tools/sync_policy_docs.mjs`, `tools/generate_requirement_evidence.mjs`, `tools/check_requirement_evidence.mjs`, `scripts/verify.sh`, `package.json`
    - 정책 문서 자동동기화, Requirement->Evidence 자동생성/검증, verify 체인 강제(`check:policy-sync`, `check:req-evidence`)를 유지한다.

## AA. Additional Hard Runtime Keys (Must Exist)

1. `championDiscoveryBudgetSplit={ champion: 0.35, discovery: 0.65 }`
2. `requirementEvidenceEnabled=true`
3. `policyDocSyncEnabled=true`
4. `stage2ResultCacheEnabled=true`
5. `stage2ResultCacheTtlSec=86400`
6. `stage2SkipDuplicatePoolSetSignature=true`
7. `stage2ScheduleMode="champion_first"`
8. `stage2ContinueAfterFirstPass=true`
9. `gapChartUnsafeCooldownRounds=6`
10. `moonshotPatternMissingCooldownRounds=12`
11. `speedProfileEnabled=true`
12. `speedProfileRequireParity=true`
13. `speedProfileExpansionGuard=true`
14. `speedProfileMaxStage2TopK={SURGE_EOD:4,GAP_15_BET:3,MOONSHOT:2}`
15. `executionLane`는 `server|codex_cloud`만 허용하고 혼합 시 `POLICY_CONFLICT_BLOCKED`.

## AB. Runtime Risk Playbook (R1-R6 Hard Mapping)

1. `R1` 필수 트랙 Stage2 무통과 반복:
   - 신호: `missingRequiredTracks` 반복 + `WORST2W_BELOW_THRESHOLD`
   - 조치: Discovery 비중 상향, daily-pass roster 수축(일자통과 상위 집중), Stage2 TopK 재배치
   - 차단: sameFailure signature 반복 시 track-local reset 1회 후 carry-over
2. `R2` MOONSHOT 엔진 쿼터 편향:
   - 신호: `RULE_QUOTA_UNMET` 반복
   - 조치: MOONSHOT rule 후보 lane 강화, quota backfill 우선순위 상향
   - 차단: `moonshotTrackRequiredForCorePass=false` 유지
3. `R3` 추천 0건 공백:
   - 신호: `ROUTER_NO_MATCH`, `POOLSET_NO_MATCH`
   - 조치: PoolSet/Member 캐스케이드 깊이 확장, 원인별 자동조치 분기
   - 차단: 0건 유지 정책 + reason code 필수
4. `R4` 메모리 압박/OOM 회귀:
   - 신호: swap 증가, stage2 런타임 급증
   - 조치: 축소 우선순위(`Stage2 TopK -> 동시 PoolSet -> 후보폭`) 즉시 적용
   - 차단: `maxWorkers<=2`, `stage2EvalConcurrency=1` (server lane)
5. `R5` 문서-코드 드리프트:
   - 신호: spec 준수 표시는 PASS인데 런타임 동작 불일치
   - 조치: 정책문서 자동주입 + requirement evidence 자동검증
   - 차단: verify fail
6. `R6` 가짜 녹색(spec check 통과, 동작 실패):
   - 신호: `check_spec_coverage` PASS인데 runtime parity 불일치
   - 조치: 행동 기반 smoke assertions + dry-run 결과 파싱 게이트
   - 차단: parity fail 시 배포 중단

## AC. Server-Only Execution Gate

1. 로컬(`/home/saida`)에서는 무거운 실행(`npm/node/docker/prisma/DB/backfill/train/build/verify`)을 금지한다.
2. 무거운 실행은 반드시 서버(`spicy-moltbook:/home/moltook/apps/stockdesk`) 또는 Codex Cloud 환경에서 수행한다.
3. 로컬 허용 작업은 `ssh/scp/rsync`, 경량 텍스트 점검, 소규모 파일 편집으로 제한한다.
4. 본 게이트 위반은 `POLICY_CONFLICT_BLOCKED`로 간주한다.

## AD. Server DB SoT + Cloud Compute Separation (Hard)

1. 서버 DB는 단일 진실원천(SoT)으로 고정한다.
2. 클라우드 런타임은 DB 직접 읽기/직접 쓰기를 기본 경로로 사용하지 않는다.
3. 클라우드 입력은 서버가 생성한 snapshot bundle(`snapshot_id`)만 사용한다.
4. 서버 데이터 전체를 사용해야 하는 경우 snapshot 생성 범위를 전체 기간/전체 필요 테이블로 확장한다.
5. NO_KIS 정책은 snapshot 생성 단계에서 강제한다(KIS 소스 행 제외/정리).
6. 클라우드 결과 반영은 서버에서만 수행한다:
   - 결과 수집(artifacts/recommendations/diagnostics)
   - idempotent upsert
   - transaction commit/rollback
7. DB 반영 키는 최소 `snapshot_id|run_id|asOf|track|poolsetSignature|policyHash`를 포함한다.
8. 동일 key 재반영은 중복 삽입이 아니라 skip/update로 처리한다.
9. 클라우드 컨테이너 12시간 캐시 초기화는 허용되며, 진행상태는 영속 저장소 checkpoint로 복원한다.
10. checkpoint 기반 재개 시에도 최종 판정 규약(Stage2-only final pass, PoolSet-first)은 변하지 않는다.
