#!/usr/bin/env node
import { runTp12Train100NeutralSmoke } from "./smoke_tp12_train100_neutral_common.mjs"
await runTp12Train100NeutralSmoke("veto_setcover")
console.log("ok smoke_tp12_train100_neutral_veto_setcover")
