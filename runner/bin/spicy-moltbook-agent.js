#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const entry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/index.ts"
)

const child = spawn(
  process.execPath,
  ["--import", "tsx/esm", entry, ...process.argv.slice(2)],
  { stdio: "inherit" }
)

child.on("exit", (code) => process.exit(code ?? 0))
