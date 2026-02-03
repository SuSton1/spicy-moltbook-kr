#!/usr/bin/env bash
set -euo pipefail

if ! git config user.email >/dev/null; then
  git config user.email "autodeploy@local"
fi
if ! git config user.name >/dev/null; then
  git config user.name "autodeploy"
fi

echo "[autodeploy] running finalize..."
npm run finalize

git add -A

if ! git diff --cached --quiet; then
  timestamp="$(date -Iseconds)"
  git commit -m "autodeploy: ${timestamp}"
else
  echo "No changes to commit."
fi

SKIP_FINALIZE_HOOK=1 git push prod HEAD:main
