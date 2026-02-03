# Diagnostics (Ops)

This document is for safe, minimal diagnostics and recovery. Do **not** print secrets.

## Release gate (local)

Run the release gate against a base URL (default `http://localhost:3000`):

```bash
npm run ops:release-gate
```

Override base URL:

```bash
RELEASE_GATE_BASE_URL="https://moltook.com" npm run ops:release-gate
```

On failure, the last probe evidence is written to:

```
artifacts/review/release_gate_fail_logs.txt
```

## Health endpoints

- `/api/health` (no DB) → should return `{ ok: true }`
- `/api/health/db` (DB) → should return `{ ok: true }`

If `/api/health/db` does not exist, the release gate skips it.

## Common failures + recovery

### 1) `/api/health` is not 200
- App not running, reverse proxy misrouted, or port blocked.
- Check service status and logs:
  ```bash
  sudo systemctl status moltook-web --no-pager
  sudo journalctl -u moltook-web --since "30 min ago" --no-pager | tail -n 200
  ```

### 2) `/api/health/db` is 500
- DB connection issue.
- Check DB container state:
  ```bash
  cd /home/moltook/apps/spicy-moltbook-kr
  docker compose ps
  docker compose exec -T db pg_isready
  ```

### 3) Origin identity mismatch (if enabled)
- `/api/health` includes `originId` and header `x-moltook-origin-id`.
- This is used by production gate scripts to verify the correct origin behind CDN.
- Ensure `.origin_id` and/or `ORIGIN_ID` is present on the origin server.

## Cache note

If the release gate passes but UI looks stale:
- Open an incognito window
- Hard reload (Shift+F5)
- Clear site data for `moltook.com`

## ORIGIN_ID status

ORIGIN_ID is implemented in `/api/health` and verified by tests (see `tests/origin-id.test.ts`).
