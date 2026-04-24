# GPT-Pro Handoff Template

다음 기획부터 이 템플릿을 복사해서 쓰면, 누락 없이 패치 적용/검증/인수인계를 한 세트로 관리할 수 있습니다.

## 빠른 시작

1. 새 번들 생성:
   - `tools/init_gptpro_patch_bundle.sh <작업명>`
2. 생성된 번들 폴더에서 아래 파일 작성:
   - `PLAN.md`
   - `FILELIST.tsv`
   - `FORMULA.md`
   - `ACCEPTANCE.md`
   - `PATCH_CHUNKS.tsv`
3. 패치 적용 중 `APPLY_LOG.jsonl`에 청크 완료 로그를 누적.
4. 최종 점검:
   - `tools/check_patch_completeness.sh --bundle <번들폴더>`

## 파일 역할

- `PLAN.md`: 변경 목적/범위/리스크/순서
- `FILELIST.tsv`: 반드시 바뀌어야 할 파일 계약(누락 방지 핵심)
- `FORMULA.md`: 계산식, 임계값, 단위, 라운딩 규칙
- `ACCEPTANCE.md`: 통과 기준/실패 기준/검증 명령
- `PATCH_CHUNKS.tsv`: 청크 단위 실행 계획
- `APPLY_LOG.jsonl`: 청크별 실제 적용 결과 로그
- `HANDOFF_PROMPT.md`: GPT-Pro에 넘길 때 쓰는 프롬프트 템플릿

## 운영 원칙

- 한 번에 크게 패치하지 말고, 청크 단위(권장 5파일/300라인 이내)로 적용.
- 청크마다 검증 명령을 실행하고 결과를 `APPLY_LOG.jsonl`에 기록.
- 마지막에 누락 검사 스크립트를 통과해야 완료로 간주.

