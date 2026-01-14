# 최대운주식 MVP 스펙

## 목표

- 홈은 쉘 수준으로 구현하되, 핵심은 증시/종목 상세 차트와 실데이터 표시.
- DATA_MODE=fixture/kis 모두 빈 화면 없이 동작.

## 화면

- 홈: 상단 앱바(최대운주식), 관심종목/바로가기/요약 카드.
- 증시: 국내/해외 탭, 코스피/코스닥 지수 카드, 랭킹 리스트.
- 종목 상세: 캔들/거래량/MA + 지표 설정 + 뉴스/공시.

## DATA_MODE

- fixture: 모든 API는 fixture 데이터를 반환.
- kis: 실데이터 표시(quote/candles/indices/rankings/news/disclosures).
- 종목 검색은 KIS 종목정보파일 기반 캐시를 사용한다.

## 지수 CLOSE=0 fallback

- 지수 값이 0/빈값이면 최근 영업일 종가로 대체.
- UI에 `최근 영업일 종가(YYYY-MM-DD) 기준` 라벨 표기.
- 서버는 일간 지수 조회 결과에서 최신 유효 종가를 선택.

## KIS 토큰/캐시

- .env.local 또는 env.local에서 키를 읽고 서버에서 자동 토큰 발급/갱신.
- 메모리 캐시 + 만료 60초 전 갱신 + 동시요청 dedupe.
- 토큰/시크릿 로그 출력 금지.

## KIS 시세 지표 매핑 (랭킹/거래대금/시가총액)

- 거래량: `output.acml_vol` (주).
- 거래대금: `output.acml_tr_pbmn` (원).
- 시가총액: `output.hts_avls` (억원) × 100,000,000 = 원.
- 키 누락 시 UI는 `—` 표시, 개발 모드에서 누락 키 경고 로그.

## Contract 모드 fixtures 갱신

- `node scripts/dump-kis-fixtures.mjs`
- 결과 파일: `server/data/kis.contract.json`

## TradingView 사용 금지

- TradingView 위젯/스크립트/워터마크 사용 금지.
- 차트 데이터는 KIS 프록시에서만 제공.

## Definition of Done (DoD)

- 모든 탭/버튼/링크 동작(죽은 클릭 금지).
- DATA_MODE=fixture 화면 빈 상태 없음.
- DATA_MODE=kis 실데이터 표시.
- Playwright가 data-testid 기반으로 가시성 검증.
- 필수 커맨드 통과:
  - npm run typecheck
  - npm test
  - npm run lint
  - npx playwright test
  - rg -n "\_reference/frames" src
  - rg -n "background-image:.\*png|<img[^>]+\\.png" src
  - rg -n "주식[[:space:]]\*친구" src public docs
