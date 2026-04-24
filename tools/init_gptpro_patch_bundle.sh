#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/init_gptpro_patch_bundle.sh <work_name>

Example:
  tools/init_gptpro_patch_bundle.sh stepd_engine_refactor
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

WORK_NAME="${1:-}"
if [[ -z "$WORK_NAME" ]]; then
  usage
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[fatal] git not found" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/docs/templates/gptpro_patch"

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "[fatal] template dir not found: $TEMPLATE_DIR" >&2
  exit 1
fi

slugify() {
  local s="$1"
  s="$(echo "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(echo "$s" | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$s" ]]; then
    s="work"
  fi
  printf '%s' "$s"
}

WORK_SLUG="$(slugify "$WORK_NAME")"
TS="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="$REPO_ROOT/artifacts/gptpro_handoff/${TS}_${WORK_SLUG}"

mkdir -p "$OUT_DIR"
cp -f "$TEMPLATE_DIR"/* "$OUT_DIR"/

cat > "$OUT_DIR/README.md" <<EOF
# GPT-Pro Patch Bundle

- bundleId: ${TS}_${WORK_SLUG}
- createdAt: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- repoRoot: $REPO_ROOT

## 다음 순서
1. PLAN/FILELIST/FORMULA/ACCEPTANCE/PATCH_CHUNKS 작성
2. 패치 진행 시 APPLY_LOG.jsonl 누적 기록
3. 완료 후 누락 검사:
   - tools/check_patch_completeness.sh --bundle "$OUT_DIR"
EOF

echo "[ok] bundle created: $OUT_DIR"
echo "[next] edit files in bundle and run:"
echo "       tools/check_patch_completeness.sh --bundle \"$OUT_DIR\""

