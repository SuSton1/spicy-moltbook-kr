# stockdesk-lab-lite 스펙

## 1. 목적
- 이벤트 정의: `High(t) / Open(t) - 1 >= 0.08`
- 기간 구조:
  - 워밍업 12개월
  - Discovery 50개월
  - Online 4개월
  - Lockbox 4개월

## 2. 파이프라인
- Step A: 이벤트 후보 추출
- Step B: 템플릿 생성(`featureVec`, `globalFeatureVec`, `seq40`, `seq150`)
- Step C: 패턴 라이브러리 생성
- Step D: 온라인 스코어링/선택/실행 게이트
- Step E: 락박스 백테스트

## 3. 고정 계약
- `pattern.mode = hybrid_150_40`
- `template.localWindow = 40`
- `template.globalWindow = 150`
- `similarity.scorerVersion = v2_exact`
- `onlineLearning.generalization.useEvalForPromotion = true`
- `decisionGate.adaptiveMinFinalScore.enabled = false`

## 4. 산출물
- `step-a/events_high8*.jsonl`
- `step-b/templates*.jsonl`
- `step-c/pattern_library*.json`
- `step-d/step_d_summary.json`
- `step-e/step_e_summary.json`
- `report/final_report.json`

## 5. 검증
- `npm run verify` 통과 필수
- Step D 승격 판단은 `promotionView.source = EVAL` 고정
- 룩어헤드 위반 0
