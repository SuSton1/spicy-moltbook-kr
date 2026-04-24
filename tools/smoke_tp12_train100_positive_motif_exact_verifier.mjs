#!/usr/bin/env node
import { runTp12PositiveMotifSmoke } from "./smoke_tp12_positive_motif_common.mjs"
await runTp12PositiveMotifSmoke("exact")
console.log("ok smoke_tp12_train100_positive_motif_exact_verifier")

