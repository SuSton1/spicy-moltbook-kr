# Family Preflight Workflow

## Goal

Use a cheap, repeatable preflight before any family patch.

This workflow exists to stop the team from spending server replay time on weak hypotheses.

## Required Outputs

Every family investigation must create two artifacts before a patch is allowed:

1. A family failure dossier
2. At least one hypothesis card

## Failure Dossier

The dossier must answer these four questions only:

1. What is the main eval failure surface right now?
2. How much recoverable upside is actually visible?
3. What is hurting top1 precision?
4. What blast-radius risk is already known from sentinel families?

Generate the raw dossier on the server with:

```bash
node tools/family_probe_dossier.mjs \
  --config=config/lab.config.server.lite.json \
  --run-id=<run_id> \
  --family-id=<family_id> \
  --format=markdown
```

Use the dossier as read-only evidence. Do not jump to a patch from intuition alone.

## Hypothesis Card

A patch is allowed only if a hypothesis card is filled.

The card must state:

1. Which bottleneck it hits directly
2. The maximum upside that the dossier suggests
3. The fastest falsifier
4. The expected blast radius
5. The validation ladder

If any of those are unknown, the hypothesis is not ready.

## Validation Ladder

Always validate in this order:

1. Read-only dossier and hypothesis review
2. One small patch
3. One single-family replay
4. Sentinel replay for `F008` and `F175`
5. Larger run only if the smaller checks stay clean

## Stop-Loss Rules

Stop the hypothesis immediately when one of these is true:

1. The dossier shows that the patch does not touch the current primary gate
2. The visible upside is too small to matter
3. A single-family replay does not move the expected metric
4. A sentinel replay regresses relative to the accepted baseline

## Classification Of Failed Hypotheses

Every failed hypothesis must be classified as one of:

1. `discarded`
2. `informational`
3. `tooling`

This prevents the same bad idea from returning under a different name.
