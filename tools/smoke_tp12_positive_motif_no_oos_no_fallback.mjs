#!/usr/bin/env node
import { runTp12PositiveMotifSmoke } from "./smoke_tp12_positive_motif_common.mjs"
await runTp12PositiveMotifSmoke("guards")
console.log("ok smoke_tp12_positive_motif_no_oos_no_fallback")

