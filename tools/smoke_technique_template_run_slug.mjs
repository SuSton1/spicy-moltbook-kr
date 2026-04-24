#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTechniqueTemplateScreenRunSlug } from "../src/lib/technique_template_screen_contract.mjs"

const ids = [
  "ma_retest_seed__anchor-ma120-break--compression-compaction20--confirm-positive-close-retention-prevclose--confirm-sponsor-quality--invalidate-failed-breakout-count20",
  "ma_retest_seed__anchor-ma120-break--compression-compaction20--confirm-positive-close-retention-prevclose--confirm-sponsor-quality",
]

const slugs = ids.map((value) =>
  buildTechniqueTemplateScreenRunSlug({
    value,
    maxLength: 96,
  }),
)

assert.equal(slugs.length, 2)
assert.notEqual(slugs[0], slugs[1])
for (const slug of slugs) {
  assert.ok(slug.length <= 96, `slug too long: ${slug.length}`)
  assert.match(slug, /^[a-z0-9_]+$/u)
}
assert.match(slugs[0], /_[0-9a-f]{8}$/u)
assert.match(slugs[1], /_[0-9a-f]{8}$/u)

console.log("ok smoke_technique_template_run_slug")
