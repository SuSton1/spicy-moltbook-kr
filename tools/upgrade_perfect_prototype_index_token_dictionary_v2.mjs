#!/usr/bin/env node

import path from "node:path"

import { parseCliArgs } from "../src/lib/args.mjs"
import { writeJsonAtomic } from "../src/lib/io.mjs"
import { repairPerfectPrototypeDirectIndexInputProvenanceArtifacts } from "../src/lib/perfect_prototype_index_provenance.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  upgradePerfectPrototypeLegacyTokenDictionarySchemaV1Artifacts,
} from "../src/lib/perfect_prototype_token_dictionary_contract_repair.mjs"
import { repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts } from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "upgrade_perfect_prototype_index_token_dictionary_v2",
  })
  const indexDirs = (Array.isArray(parsed?._) ? parsed._ : [])
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (indexDirs.length < 1) {
    throw new Error(
      "Usage: node tools/upgrade_perfect_prototype_index_token_dictionary_v2.mjs <index-dir-1> <index-dir-2> ...",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: indexDirs.map((filePath, index) => ({
      label: `indexDir[${index}]`,
      filePath,
    })),
    policy: serverPolicy,
    toolName: "upgrade_perfect_prototype_index_token_dictionary_v2",
  })

  const entries = []
  for (const indexDir of indexDirs) {
    const provenanceRepair = await repairPerfectPrototypeDirectIndexInputProvenanceArtifacts({
      indexDir,
      write: true,
    })
    const fingerprintRepair = await repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts({
      indexDir,
      write: true,
    })
    const dictionaryUpgrade = await upgradePerfectPrototypeLegacyTokenDictionarySchemaV1Artifacts({
      cwd,
      indexDir,
      write: true,
    })
    entries.push({
      indexDir,
      repaired:
        provenanceRepair.repaired ||
        fingerprintRepair.repaired ||
        dictionaryUpgrade.repaired,
      changedFiles: Array.from(
        new Set([
          ...provenanceRepair.changedFiles,
          ...fingerprintRepair.changedFiles,
          ...dictionaryUpgrade.changedFiles,
        ]),
      ),
      tokenizerSpecHash: fingerprintRepair.fingerprintMetadata.tokenizerSpecHash,
      inputStateHash: provenanceRepair.inputProvenance.inputStateHash,
      dictionaryUpgraded: dictionaryUpgrade.upgradedDictionary,
      dictionaryRowCount: dictionaryUpgrade.dictionaryRowCount,
    })
  }

  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    inspectedIndexCount: entries.length,
    repairedIndexCount: entries.filter((entry) => entry.repaired === true).length,
    upgradedDictionaryCount: entries.filter((entry) => entry.dictionaryUpgraded === true).length,
    entries,
  }
  const summaryPath = path.join(indexDirs[0], "..", "..", "upgrade_token_dictionary_v2_summary.json")
  await writeJsonAtomic(summaryPath, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
