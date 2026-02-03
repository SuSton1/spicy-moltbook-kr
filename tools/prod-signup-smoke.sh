#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PROD_BASE_URL:-https://moltook.com}"
COOKIE_JAR="$(mktemp)"

cleanup() {
  rm -f "${COOKIE_JAR}"
}
trap cleanup EXIT

echo "[smoke] base_url=${BASE_URL}"

challenge_json="$(curl -fsS "${BASE_URL}/api/auth/signup-challenge" -c "${COOKIE_JAR}")"

CHALLENGE_JSON="${challenge_json}" node - <<'NODE'
const input = process.env.CHALLENGE_JSON ?? ""
try {
  const parsed = JSON.parse(input)
  const data = parsed?.data ?? {}
  const token = data.token ? `[token:${String(data.token).length} chars]` : null
  console.log("[smoke] challenge:", {
    enabled: data.enabled,
    nonce: data.nonce,
    difficulty: data.difficulty,
    expiresAt: data.expiresAt,
    token,
  })
} catch {
  console.log("[smoke] challenge: invalid json")
}
NODE

uid="$(date +%s)"
payload="$(CHALLENGE_JSON="${challenge_json}" node - <<'NODE'
const input = process.env.CHALLENGE_JSON ?? ""
let token = ""
try {
  const data = JSON.parse(input).data ?? {}
  token = data.token ?? ""
} catch {
  token = ""
}
const uid = Date.now().toString()
const payload = {
  username: `smoke_${uid}`,
  email: `smoke_${uid}@example.com`,
  password: "Goodpass1",
  passwordConfirm: "Goodpass1",
  acceptTerms: true,
  powSolution: "invalid",
  powToken: token,
}
process.stdout.write(JSON.stringify(payload))
NODE
)"

raw_response="$(
  curl -sS -D - -o - \
    -H "Content-Type: application/json" \
    -H "Origin: ${BASE_URL}" \
    -b "${COOKIE_JAR}" \
    -c "${COOKIE_JAR}" \
    -X POST "${BASE_URL}/api/auth/register" \
    --data "${payload}" || true
)"

printf "%s" "${raw_response}" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
const parts = raw.split(/\r?\n\r?\n/);
const head = parts.shift() ?? "";
const body = parts.join("\n\n").trim();
const statusMatch = head.match(/^HTTP\/[^\s]+\s+(\d+)/m);
const reqMatch = head.match(/^x-req-id:\s*(.+)$/im);
const status = statusMatch ? statusMatch[1] : "";
const reqId = reqMatch ? reqMatch[1].trim() : "";
console.log(`[smoke] status=${status} x-req-id=${reqId}`);
console.log("[smoke] body:");
console.log(body);
'
