# stockdesk-lab-lite

경량 패턴 연구 레포입니다.

목표:
- 갭 제외 당일 시가 대비 당일 고가 +8% 이벤트(`High(t)/Open(t)-1 >= 0.08`)를 기반으로 패턴을 추출
- 일별 Top1 종목 선택 엔진을 구축
- 온라인 학습 구간과 락박스 구간을 분리해 성능 검증

## 빠른 시작

실험 재개 전 체크:
```bash
cat meta/experiment_patch_memory.json
bash tools/check_duplicate_experiment.sh --patch-key=<PATCH_KEY>
```

1. 설정 파일 준비
```bash
cp config/lab.config.example.json config/lab.config.json
```

1-1. 서버 duckdb CLI 설치(필수, 폴백 없음)
```bash
bash tools/install_duckdb_cli.sh
```

2. 전체 파이프라인 실행
```bash
npm run lab:all -- --config=config/lab.config.json
```

2-1. 증분 실행(입력/설정 불변 step 재사용)
```bash
npm run lab:all:inc -- --config=config/lab.config.json
```
추가 옵션:
- `--incremental-reuse-mode=hardlink|copy` (기본 `hardlink`)

3. 단계별 실행
```bash
npm run lab:step-a -- --config=config/lab.config.json
npm run lab:step-b -- --config=config/lab.config.json --run-id=<RUN_ID>
npm run lab:step-c -- --config=config/lab.config.json --run-id=<RUN_ID>
npm run lab:step-d -- --config=config/lab.config.json --run-id=<RUN_ID>
npm run lab:step-e -- --config=config/lab.config.json --run-id=<RUN_ID>
npm run lab:report -- --config=config/lab.config.json --run-id=<RUN_ID>
```

서버 기본 설정 파일:
- `config/lab.config.server.json`
- `config/lab.config.server.lite.json` (경량 반복 실험용)

경량 반복 실행 예시:
```bash
npm run lab:all -- --config=config/lab.config.server.lite.json
```

경량화 핵심:
- Step A: 엔진은 `duckdb` 고정 (강제)
  - `duckdb`: SQL 프리필터로 고가 8% 원후보를 먼저 추출 (미설치 시 즉시 에러, 폴백 없음)
  - 내부 후보 통과 계산은 `bitset` 교집합으로 처리 (`duckdb+bitset` 하이브리드)
  - `bitset/classic/auto` 단독 운영은 strict 정책에서 차단
- Step B: lite 입력 자동 선호 + 하이브리드 템플릿 생성
  - `seq40`(local) + `seq150`(global)
  - `featureVec` + `globalFeatureVec`
- Step C: 하이브리드 라이브러리 생성
  - 글로벌 군집(`globalClusters`) + 로컬 프로토타입(`localPrototypes`)
  - `pattern_library_runtime.json`에 `stageWeights/coarse/windows/clusterCenters` 저장
- Step D/E: 일별 전종목 순회 대신 bitset 후보 인덱스 사전축소 후 스코어링/백테스트
  - 스코어러: `similarity.scorerVersion=v2_exact` (정확 조기종료)
  - 2-stage 점수: coarse(global) -> fine(local) + trigger 가중합
  - Step D가 lockbox 의사결정 audit를 정식 산출물로 생성하고, Step E는 이를 canonical 입력으로 사용
  - Step E는 Step D lockbox audit 기반으로 trade replay/집계만 수행(재스코어링 제거)
- 검증 게이트: `verify`에서 strict mode 체크를 실행하여 폴백 키/런타임 표식을 차단

Step A 소규모 성능 비교(하이브리드 vs 클래식):
```bash
bash tools/bench_step_a_quick.sh
```

서버 동기화(데이터/실행결과 보존):
```bash
bash scripts/sync_to_server.sh
```

오래된 run 정리:
```bash
npm run runs:cleanup -- --keep=40 --apply=true
```

## 산출물

`artifacts/runs/<RUN_ID>/`
- `step-a/events_high8.jsonl`
- `step-a/events_high8_lite.jsonl`
- `step-b/templates.jsonl`
- `step-b/templates_lite.jsonl`
- `step-b/templates_runtime_pack.jsonl`
- `step-c/pattern_library.json`
- `step-c/pattern_library_runtime.json`
- `step-d/daily_online_logs.jsonl`
- `step-d/decision_candidates_index.jsonl`
- `step-d/decision_candidates_index_meta.json`
- `step-d/decision_candidates_feature_pack.jsonl`
- `step-d/decision_candidates_feature_pack_meta.json`
- `step-d/perf_counters.json`
- `step-e/lockbox_trades.jsonl`
- `step-e/perf_counters.json`
- `report/final_report.json`

## 참고 문서
- [SPEC.md](SPEC.md)
- [데이터 계약](docs/data_contracts.md)
