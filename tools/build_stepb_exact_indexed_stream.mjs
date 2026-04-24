import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, toRunId } from "../src/lib/io.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { hashPerfectPrototypeMiningInputFile } from "../src/lib/perfect_prototype_mining_cache.mjs"
import {
  buildPerfectPrototypeStepbExactIndexedStream,
} from "../src/lib/perfect_prototype_stepb_exact_indexed_stream.mjs"

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

const resolveOutDir = ({ cwd, parsed }) => {
  const rawOutDir = String(getFlag(parsed.flags, "out-dir", "")).trim()
  if (rawOutDir) {
    return path.resolve(rawOutDir)
  }
  const outRunId = String(
    getFlag(parsed.flags, "out-run-id", `perfect_proto_stepb_exact_indexed_stream_${toRunId(new Date())}`),
  ).trim()
  return path.join(cwd, "artifacts", "runs", outRunId, "step-perfect-prototype-indexed-stream")
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_exact_indexed_stream",
  })
  const sourceRunId = String(getFlag(parsed.flags, "source-run-id", "")).trim()
  const rawInputPath = String(getFlag(parsed.flags, "input", "")).trim()
  const inputPath = rawInputPath
    ? path.resolve(rawInputPath)
    : sourceRunId
      ? path.join(cwd, "artifacts", "runs", sourceRunId, "step-b", "templates_lite.jsonl")
      : ""
  const rawTokenizerSpecPath = String(getFlag(parsed.flags, "tokenizer-spec", "")).trim()
  const tokenizerSpecPath = rawTokenizerSpecPath ? path.resolve(rawTokenizerSpecPath) : ""
  const outDir = resolveOutDir({ cwd, parsed })
  if (!inputPath || !tokenizerSpecPath || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_exact_indexed_stream.mjs --input=<jsonl> --tokenizer-spec=<tokenizer_spec.json> --out-dir=<dir> | --out-run-id=<run>",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "tokenizerSpec", filePath: tokenizerSpecPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_stepb_exact_indexed_stream",
  })
  const tokenizerSpec = await readJson(tokenizerSpecPath, null)
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error(`Tokenizer spec must be a JSON object: ${tokenizerSpecPath}`)
  }
  const inputSha256 = await hashPerfectPrototypeMiningInputFile(inputPath)
  await buildPerfectPrototypeStepbExactIndexedStream({
    cwd,
    inputPath,
    inputSha256,
    tokenizerSpec,
    tokenizerSpecPath,
    outDir,
    options: {
      trainStartDate: normalizeText(getFlag(parsed.flags, "train-start", "")),
      trainEndDate: normalizeText(getFlag(parsed.flags, "train-end", "")),
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
