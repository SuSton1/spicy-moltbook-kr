#!/usr/bin/env node

import assert from "node:assert/strict"

import {
  assertLiveFeatureFieldList,
  assertNoForbiddenScopeFields,
} from "../src/lib/tp12_precision_first_feature_whitelist.mjs"

assert.doesNotThrow(() => {
  assertLiveFeatureFieldList(["supportQualityRatio", "return5d", "marketUpRatio"], { contextLabel: "smoke" })
})

assert.throws(
  () => assertLiveFeatureFieldList(["supportQualityRatio", "maxForwardReturn"], { contextLabel: "smoke" }),
  /label-only fields/,
)

assert.throws(
  () => assertNoForbiddenScopeFields({ decisionDateKey: "2024-01-02", investorNetBuy: 1 }, { contextLabel: "smoke row" }),
  /forbidden non-daily-only field/,
)

console.log("[ok] tp12 precision-first feature whitelist smoke")

