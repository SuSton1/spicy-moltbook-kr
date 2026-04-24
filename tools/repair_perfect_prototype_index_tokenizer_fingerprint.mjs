#!/usr/bin/env node

import path from "node:path"

import { parseCliArgs } from "../src/lib/args.mjs"
import { writeJsonAtomic } from "../src/lib/io.mjs"
import { repairPerfectPrototypeDirectIndexInputProvenanceArtifacts } from "../src/lib/perfect_prototype_index_provenance.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts } from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "repair_perfect_prototype_index_tokenizer_fingerprint",
  })
  const indexDirs = (Array.isArray(parsed?._) ? parsed._ : [])
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (indexDirs.length < 1) {
    throw new Error(
      "Usage: node tools/repair_perfect_prototype_index_tokenizer_fingerprint.mjs <index-dir-1> <index-dir-2> ...",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: indexDirs.map((filePath, index) => ({
      label: `indexDir[${index}]`,
      filePath,
    })),
    policy: serverPolicy,
    toolName: "repair_perfect_prototype_index_tokenizer_fingerprint",
  })

  const repairedEntries = []
  for (const indexDir of indexDirs) {
    const provenanceRepair = await repairPerfectPrototypeDirectIndexInputProvenanceArtifacts({
      indexDir,
      write: true,
    })
    const fingerprintRepair = await repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts({
      indexDir,
      write: true,
    })
    repairedEntries.push(
      {
        indexDir,
        repaired: provenanceRepair.repaired || fingerprintRepair.repaired,
        changedFiles: Array.from(
          new Set([...provenanceRepair.changedFiles, ...fingerprintRepair.changedFiles]),
        ),
        inputProvenance: provenanceRepair.inputProvenance,
        fingerprintMetadata: fingerprintRepair.fingerprintMetadata,
      },
    )
  }

  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repairedIndexCount: repairedEntries.filter((entry) => entry.repaired === true).length,
    inspectedIndexCount: repairedEntries.length,
    entries: repairedEntries.map((entry) => ({
      indexDir: entry.indexDir,
      repaired: entry.repaired,
      changedFiles: entry.changedFiles,
      tokenizerSpecHash: entry.fingerprintMetadata.tokenizerSpecHash,
      tokenizerSpecFingerprintVersion: entry.fingerprintMetadata.tokenizerSpecFingerprintVersion,
      inputStateHash: entry.inputProvenance.inputStateHash,
      inputPathCount: entry.inputProvenance.inputPaths.length,
    })),
  }

  const toolSummaryPath = path.join(indexDirs[0], "..", "..", "repair_tokenizer_fingerprint_summary.json")
  await writeJsonAtomic(toolSummaryPath, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
