#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { auditTp12AsofSurvivorship } from "./audit_tp12_asof_survivorship.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-asof-survivorship-"))
const lifecyclePath = path.join(tmp, "lifecycle.jsonl")
const eventsPath = path.join(tmp, "events.jsonl")
await fs.writeFile(
  lifecyclePath,
  [
    { symbol: "000001", listedFrom: "2010-01-01", delistedOn: "2019-12-30" },
    { symbol: "000002", listedFrom: "2010-01-01", delistedOn: null },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)
await fs.writeFile(
  eventsPath,
  [
    { symbol: "000001", decisionDateKey: "2018-01-03", isListed: false },
    { symbol: "000002", decisionDateKey: "2020-01-03", isListed: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

const passed = await auditTp12AsofSurvivorship({
  eventsPath,
  lifecyclePath,
  dateFrom: "2018-01-01",
  dateTo: "2020-12-31",
})
assert.equal(passed.status, "passed")
assert.equal(passed.listedFalseButActiveAsOfRowCount, 1)

await fs.writeFile(
  eventsPath,
  [{ symbol: "000001", decisionDateKey: "2020-01-03" }].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)
await assert.rejects(
  () =>
    auditTp12AsofSurvivorship({
      eventsPath,
      lifecyclePath,
    }),
  /inactive_asof_rows:1/,
)

await fs.writeFile(
  eventsPath,
  [{ symbol: "000001", decisionDateKey: "2019-12-30" }].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)
await assert.rejects(
  () =>
    auditTp12AsofSurvivorship({
      eventsPath,
      lifecyclePath,
    }),
  /inactive_asof_rows:1/,
)

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_asof_survivorship_gate")
