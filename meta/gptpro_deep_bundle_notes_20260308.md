# Stockdesk Lab Lite Deep Diagnosis Notes (2026-03-08)

## 목적
- 이 번들은 `stockdesk-lab-lite`의 최근 plateau 원인을 GPT Pro가 구조적으로 다시 진단할 수 있게 만들기 위한 것이다.
- 목표는 `데이터 누수 없이 미래 실매매에서도 유지될 TARGET 적중률 / 승률 / 수익률`을 높이는 것이다.
- 임시 threshold 조정보다 구조 문제를 우선 본다.

## 운영 원칙
- 운영 부모는 항상 `accepted baseline` 하나만 사용한다.
- 현재 accepted baseline은 `probe12`다.
- 분석용 Step D 최고치는 `candidate peak = probe38`이다.
- 연구용 계보는 운영 부모와 분리해서 본다.
- 실패 실험은 운영 부모에 누적하지 않는다.
- 좋은 조각을 섞어 새 부모를 만들지 않는다.
- Step E는 증상 계층에 가깝고, C보다 D를 먼저 고친다.

## 최근 핵심 판단
1. 최근 plateau의 본체는 `Step C`가 아니라 `Step D`다.
2. 더 정확히는:
   - `D1 랭킹 목적함수 왜곡`
   - `D2 게이팅(day-type / agreement / meta / uncertainty) 과차단`
   가 핵심이다.
3. `Step E`는 원인보다 D 결과를 재생하는 후행 증상에 가깝다.
4. `Step C`는 배경 요인이지 최근 plateau의 직접 원인은 아니다.

## probe12 -> probe149에서 드러난 핵심
- 집행 수 자체는 거의 줄지 않았다.
  - Step D `executedCountEval`: `22 -> 21`
- 그런데 집행 품질은 크게 악화됐다.
  - Step D `executedHitRateEval`: `40.91% -> 19.05%`
- Step E TARGET 적중률은 더 심하게 무너졌다.
  - `TARGET: 6/20 (30.0%) -> 1/18 (5.56%)`
- 결론:
  - 문제는 “거래를 덜 해서”가 아니다.
  - “거래한 것의 순서/질이 무너졌다”가 핵심이다.

## 왜 C보다 D가 1순위 병목인가
- probe149는 좋은 종목이 완전히 사라진 게 아니다.
- `firstSuccessRank==1`은 크게 무너졌지만
- `firstSuccessRank<=3`는 거의 비슷한 수준이었다.
- 뜻:
  - 좋은 종목이 top3/top10 안에는 남아 있다.
  - 그런데 top1을 잘못 고르고 있다.
- 따라서 최근 병목은 C retrieval보다는 D1 ordering이다.

## 왜 C가 직접 원인이 아닌가
- probe12와 probe149 사이에서 C 분포는 나빠지긴 했다.
  - `runtimePrototypeCount: 120 -> 89`
  - `prunedByConsistency: 0 -> 31`
- 하지만 결정적 반증이 있다.
  - `probe38`도 거의 같은 C 상태(`88/32`)인데
  - Step D 성능은 probe149보다 훨씬 좋았다.
- 결론:
  - 지금 plateau는 “C가 망가져서”라기보다
  - “현재 C를 D가 제대로 못 쓰고 있어서” 생긴 문제다.

## 왜 E가 원인이 아닌가
- Step E는 구조상 D1/D2 결과를 재생/정산하는 계층이다.
- E를 먼저 고쳐도 원인 해결보다 증상 가리기가 된다.
- 순서는 반드시:
  - `C/E 먼저`가 아니라
  - `D 먼저`

## 현재 구조적 원인 4개

### A. D1이 TARGET-first가 아니라 execution-safe 쪽으로 기운다
- 현재 D1 rerank utility에는 아래가 한 점수에 섞여 있다.
  - `targetRate`
  - `stopRate`
  - `pHit`
  - `pStopFirst`
  - `fillProb`
  - `slippageRisk`
  - `quality`
  - `scoreMargin`
  - 기타 safety 성격 변수
- 실제 가중치는 target보다 fill/slippage 같은 체결 안전성 쪽이 더 크게 먹을 수 있다.
- 결과:
  - 목표가까지 잘 가는 종목보다
  - “안전해 보이지만 TARGET은 못 찍고 TIMEOUT 되는 종목”이 위로 올라온다.
- probe149의 Step E가 `TARGET 1 / TIMEOUT 10`으로 무너진 것과 일치한다.

### B. tradeQualityPrior가 잘못된 기억을 D1에 주입한다
- 현재 tradeQualityPrior는 다음을 섞는다.
  - `TARGET`
  - `STOP`
  - `TIMEOUT 양수`
  - `소폭 양수 수익`
  - `selected candidate 흔적`
- 즉 “목표가를 잘 맞힌 기억”이 아니라 “대충 덜 나빴던 기억”이다.
- 그런데 이걸 다시 D1 점수에 직접 더하니
  - 미래에도 비슷한 miss를 위로 올리는 자기강화 루프가 된다.
- 실제 흔적:
  - `tradeQualityPriorAdjustment > 0`인 top1의 hit rate가 더 낮게 나온 적이 반복됐다.

### C. day-type가 shadow에서 hard no-trade로 해석된다
- probe12는 day-type가 주로 shadow였다.
- probe149는 이게 hard no-trade로 더 강하게 해석됐다.
- 결과:
  - `dayTypeNoTradeCount = 11`
  - 그중 hit 기회가 있던 날 = `10`
- 의미:
  - 분류기가 틀렸다기보다
  - 그 출력을 “그냥 거래 금지”로 해석한 정책 의미가 과했다.

### D. agreement / meta / uncertainty가 TARGET 후보를 추가로 깎는다
- 최근 plateau probe들에서 D2 blocker는 반복적으로 아래가 상위였다.
  - `AGREEMENT_CONSENSUS_LOW`
  - `TARGET_RATE_LOW`
  - `STOP_RATE_HIGH`
  - `META_UTILITY_LOW`
- 즉 D2도
  - “목표가 갈 놈인가?”보다
  - “합의가 낮다 / 불확실하다 / 체결 안전성이 덜하다” 쪽으로 기운다.
- 그래서 D1이 겨우 올린 후보도 D2에서 또 잘린다.

## 장기학습 state가 쌓이는데도 TARGET 적중률이 안 오르는 이유
- 문제는 state가 안 쌓이는 게 아니다.
- 오히려 state는 계속 쌓인다.
- 하지만 그 state가 학습하는 목표가 틀렸다.

현재 state가 배우는 것:
- `TARGET`
- `STOP`
- `TIMEOUT 양수`
- `소폭 양수 net return`
- `selected candidate 흔적`

이걸 섞어서 “좋은 기억”처럼 저장한다.
그래서 반복할수록:
- TARGET 적중률을 올리는 학습이 아니라
- TIMEOUT 생존 / 양수 마감 / 보수적 miss를 선호하는 학습이 강화된다.

즉 지금은:
- 학습이 안 되는 게 아니라
- 잘못된 목적을 잘 학습하고 있는 상태다.

## 최근 실패 실험에서 얻은 것
- aggressive target-first split: regression, 폐기
- executed_only split prior rewrite: regression, 폐기
- day-type contract mode only: regression, 폐기
- rank-core / execution-tiebreak split: regression, 폐기
- agreement consensus temporal rescue: regression, 폐기

이 실험들은 “어떤 방향이 안 먹는지”를 알려준다.
- D1 점수를 한 번에 크게 갈아엎는 패치: 과함
- day-type만 풀어버리는 패치: 과함
- blanket agreement rescue: 과함
- prior를 어설프게 떼는 패치: ordering 붕괴 가능

## 현재 코드에서 꼭 볼 파일
- `src/pipeline/step_c_pattern_mine.mjs`
- `src/pipeline/step_d_online_loop.mjs`
- `src/lib/decision_policy.mjs`
- `src/lib/step_policy_chain.mjs`
- `src/lib/execution_gate.mjs`
- `src/lib/day_type_policy.mjs`
- `src/pipeline/step_e_lockbox_backtest.mjs`
- `src/pipeline/cd_loop.mjs`
- `config/lab.config.server.lite.json`

## 다음 우선순위 제안
### 1순위
`tradeQualityPrior`를 다시 정의하고 D1 점수 가산에서 완전히 분리할 것.
- `executed_only` 강제
- `target / stop / timeout+ / timeout-` 분리
- D1 점수 가산 금지
- D2 contract 보조 또는 진단용으로만 사용

### 2순위
D1 objective를 “전체 갈아엎기”가 아니라 “base ordering 유지 + target 관련 rerank 강화”로 보수적으로 재설계할 것.
- 지금처럼 execution-safe 성격을 한 utility에 크게 섞지 않도록 조정

### 3순위
`day-type / agreement`를 blanket veto가 아니라 contract mode로 내릴 것.
- 다만 day-type만 단독으로 완화하는 패치는 이미 실패했으므로
- D1 ordering 수정을 먼저 하고 그 뒤에 보는 게 맞다.

## 하지 말아야 할 것
- threshold만 만지는 패치
- tradeQualityPrior on/off만 하는 패치
- Step E부터 손보기
- Step C부터 다시 복원하기
- day-type를 더 강하게 막기
- `selected_candidates`를 계속 state에 누적하기
- “더 많이 돌리면 해결될 것”이라고 보는 것

## 현재 리더보드 핵심
- accepted baseline:
  - `probe12`
  - Step E TARGET 적중률 `30.0%`
  - winRate `50.0%`
  - avgNetRet `1.1323%`
  - cumulativeReturn `22.07%`
- candidate peak:
  - `probe38`
  - Step D 상위 지표 고점

## 연구 레인 목적
- `probe38` 부모에서 장기학습을 5~10회 연속 돌려
  - `firstSuccessRank==1`
  - `top1ToOracleConversion`
  - `executedTargetHitRate`
  - Step E TARGET 적중률
  - Step E avgNetRet
의 기울기를 본다.
- 우상향이 없으면 이 부모도 폐기해야 한다.

## 요약
지금 stockdesk-lab-lite는:
- C가 pattern/prototype 공간을 만들고
- D가 그 공간을 정렬/해석하고
- E가 결과를 재생하는 구조다.

최근 plateau의 직접 원인은:
- C 부족이 아니라
- D1 ordering 왜곡
- D2 과차단
- 잘못 정의된 장기학습 state 재주입이다.

즉 지금 장기학습 문제는:
- “학습이 안 돈다”가 아니라
- “학습 state가 적재적소에 쓰이지 않고 잘못된 위치에 잘못된 의미로 주입되고 있다”는 구조 문제다.
