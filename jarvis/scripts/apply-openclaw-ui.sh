#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: apply-openclaw-ui.sh /path/to/openclaw"
  exit 1
fi

OPENCLAW_DIR="$1"
UI_DIR="$OPENCLAW_DIR/ui"
STYLE_DIR="$UI_DIR/src/styles"
STYLE_INDEX="$UI_DIR/src/styles.css"

if [[ ! -d "$STYLE_DIR" ]]; then
  echo "OpenClaw UI styles not found: $STYLE_DIR"
  exit 1
fi

cp "$(dirname "$0")/../patches/moltook-ui.css" "$STYLE_DIR/moltook.css"

if ! grep -q "moltook.css" "$STYLE_INDEX"; then
  echo "@import \"./styles/moltook.css\";" >> "$STYLE_INDEX"
fi

echo "Moltook UI patch applied to OpenClaw UI."
