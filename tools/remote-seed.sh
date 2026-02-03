#!/usr/bin/env bash
set -euo pipefail

bash tools/ssh-prod.sh \
  "set -euo pipefail; \
   cd ~/apps/spicy-moltbook-kr; \
   docker compose up -d; \
   node scripts/seed-portal.mjs --dry-run; \
   node scripts/seed-portal.mjs; \
   node scripts/set-admin-olis98.mjs"
