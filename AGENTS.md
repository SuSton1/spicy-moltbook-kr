# Agent Guidelines

## Completion Criteria

### Non-negotiable: Production Connectivity Gate (Domain Regression)
Before marking ANY task as DONE, ALWAYS run:
  npm run prod:gate

Rules:
- If prod:gate FAILS, you MUST fix production until it PASSES (or output BLOCKED with evidence + exact manual steps).
- If you performed a deploy (or changed anything intended to reach prod), run prod:gate AGAIN after deploy completes.
- In the final response, paste the prod:gate output and include a short root-cause note when a failure happened.
- No false DONE: never claim DONE with a failing gate.

### Non-negotiable: Always finalize with production connectivity
After ANY patch, you MUST run:
  npm run finalize

Rules:
- If finalize FAILS, you MUST fix until it PASSES.
- NEVER claim DONE without pasting prod:gate PASS output from finalize.
- If prod:gate fails, iterate: prod:recover + prod:origin:init until PASS.
- The user must not remind you to check the domain; this is automatic.
- Pre-push hooks enforce finalize automatically; do not bypass unless explicitly instructed.
