# HANDOFF PROMPT (GPT-Pro)

아래 계약을 반드시 지키면서 변경해 주세요.

## 계약 파일
- PLAN.md
- FILELIST.tsv
- FORMULA.md
- ACCEPTANCE.md
- PATCH_CHUNKS.tsv

## 필수 규칙
1. `FILELIST.tsv`의 대상 파일은 누락 없이 반영.
2. `PATCH_CHUNKS.tsv` 순서대로 청크 적용.
3. 청크 완료마다 `APPLY_LOG.jsonl`에 1줄 기록.
4. 각 청크 후 지정 검증 명령 실행.
5. 마지막에 `tools/check_patch_completeness.sh --bundle <bundle_dir>` 통과.

## 출력 형식
- 변경 요약(청크별)
- 실패/보류 항목
- 검증 결과(pass/fail)
- 누락 검사 결과(pass/fail)

