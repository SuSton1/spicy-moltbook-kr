#!/usr/bin/env node
import { runTp12PositiveMotifSmoke } from "./smoke_tp12_positive_motif_common.mjs"
await runTp12PositiveMotifSmoke("negatives")
console.log("ok smoke_tp12_motif_negative_control_builder")

