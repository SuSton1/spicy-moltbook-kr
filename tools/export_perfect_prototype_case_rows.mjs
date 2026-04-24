import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  buildPerfectPrototypeSupportCaseId,
  normalizePerfectPrototypeSupportCases,
} from "../src/lib/perfect_prototype_support_case.mjs"
import {
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  normalizePerfectPrototypeRow,
  tokenizePerfectPrototypeRow,
} from "../src/lib/perfect_prototype_tokenizer.mjs"

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const parseCaseIds = (value) =>
  uniqueSorted(String(value ?? "").split(","))
    .map((caseId) => {
      const [symbolRaw, dateKeyRaw] = String(caseId ?? "").trim().split(":")
      const symbol = toText(symbolRaw)
      const dateKey = toText(dateKeyRaw)
      const normalizedCaseId = buildPerfectPrototypeSupportCaseId({ symbol, dateKey })
      if (!normalizedCaseId) {
        throw new Error(`Invalid support case id: ${caseId}`)
      }
      return { caseId: normalizedCaseId, symbol, dateKey }
    })

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input-path", "")).trim())
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const outPath = path.resolve(String(getFlag(parsed.flags, "out-path", "")).trim())
  const caseIds = parseCaseIds(getFlag(parsed.flags, "case-ids", ""))
  const familyIds = uniqueSorted(String(getFlag(parsed.flags, "family-ids", "")).split(","))
  const donorRuleIds = uniqueSorted(String(getFlag(parsed.flags, "donor-rule-ids", "")).split(","))
  const note = toText(getFlag(parsed.flags, "note", ""))
  const enableIntervalAtoms =
    String(getFlag(parsed.flags, "enable-interval-atoms", "")).trim() === "true"
  const enableMacroAtoms =
    String(getFlag(parsed.flags, "enable-macro-atoms", "")).trim() === "true"
  const enableSupportAnchorAtoms =
    String(getFlag(parsed.flags, "enable-support-anchor-atoms", "")).trim() === "true"
  const enableSupportManifoldSignature =
    String(getFlag(parsed.flags, "enable-support-manifold-signature", "")).trim() === "true"
  const enableAdaptiveThresholdAtoms =
    String(getFlag(parsed.flags, "enable-adaptive-threshold-atoms", "")).trim() === "true"
  if (!inputPath || !catalogPath || !outPath || caseIds.length < 1) {
    throw new Error(
      "Usage: node tools/export_perfect_prototype_case_rows.mjs --input-path=<daily_pack.jsonl> --catalog=<catalog.json> --case-ids=<symbol:dateKey,...> --out-path=<support_cases.json> [--family-ids=<family_a,...>] [--donor-rule-ids=<rule_a,...>] [--note=<text>]",
    )
  }
  const catalog = await loadPerfectPrototypeCatalog(catalogPath)
  const tokenizerSpec = catalog?.tokenizerSpec ?? null
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error(`Catalog is missing tokenizerSpec: ${catalogPath}`)
  }
  const donorTokenSet = new Set()
  if (donorRuleIds.length > 0) {
    const ruleById = new Map(
      (Array.isArray(catalog?.rules) ? catalog.rules : []).map((rule) => [
        String(rule?.ruleId ?? "").trim(),
        rule,
      ]),
    )
    for (const donorRuleId of donorRuleIds) {
      const donorRule = ruleById.get(donorRuleId)
      if (!donorRule) {
        throw new Error(`donor rule is missing from catalog: ${donorRuleId}`)
      }
      const donorRuleTokens = uniqueSorted(donorRule?.tokens)
      if (donorRuleTokens.length < 1) {
        throw new Error(`donor rule is missing tokens: ${donorRuleId}`)
      }
      for (const token of donorRuleTokens) {
        donorTokenSet.add(token)
      }
    }
  }
  const rows = await readJsonl(inputPath)
  const supportCases = caseIds.map((requestedCase) => {
    const row = rows.find(
      (candidate) =>
        String(candidate?.symbol ?? "").trim() === requestedCase.symbol &&
        String(candidate?.dateKey ?? "").trim() === requestedCase.dateKey,
    )
    if (!row) {
      throw new Error(
        `support case ${requestedCase.caseId} is missing from input-path=${inputPath}`,
      )
    }
    const normalizedRow = normalizePerfectPrototypeRow(row, {
      ...(tokenizerSpec?.options ?? {}),
      surfaceName: tokenizerSpec?.surface ?? null,
    })
    const supportSignatureConfig =
      enableSupportManifoldSignature === true
        ? buildPerfectPrototypeSupportSignatureTokenizerConfig({
            familyId: familyIds[0] ?? null,
            supportCases: normalizePerfectPrototypeSupportCases([
              {
                caseId: requestedCase.caseId,
                symbol: requestedCase.symbol,
                dateKey: requestedCase.dateKey,
                familyIds,
                tokens: ["seed:support_signature_config"],
                categoricalTokens: normalizedRow?.categoricalTokens ?? [],
                numericFeatureMap: normalizedRow?.numericFeatureMap ?? {},
                donorRuleIds,
                donorTokens: Array.from(donorTokenSet),
                note,
              },
            ]),
          })
        : null
    const tokens = tokenizePerfectPrototypeRow(row, tokenizerSpec, {
      enableIntervalAtoms,
      enableMacroAtoms,
      enableSupportAnchorAtoms,
      enableSupportManifoldSignature,
      enableAdaptiveThresholdAtoms,
      supportSignatureConfig,
    })
    return {
      caseId: requestedCase.caseId,
      symbol: requestedCase.symbol,
      dateKey: requestedCase.dateKey,
      familyIds,
      tokens,
      categoricalTokens: normalizedRow?.categoricalTokens ?? [],
      numericFeatureMap: normalizedRow?.numericFeatureMap ?? {},
      supportSignatureFeatureKeys: supportSignatureConfig?.featureKeys ?? [],
      donorRuleIds,
      donorTokens: Array.from(donorTokenSet),
      note,
    }
  })
  const payload = {
    generatedAt: new Date().toISOString(),
    inputPath,
    catalogPath,
    donorRuleIds,
    tokenizerSurface: String(tokenizerSpec?.surface ?? "").trim() || null,
    tokenizerOptionsOverride: {
      enableIntervalAtoms,
      enableMacroAtoms,
      enableSupportAnchorAtoms,
      enableSupportManifoldSignature,
      enableAdaptiveThresholdAtoms,
    },
    supportCases: normalizePerfectPrototypeSupportCases(supportCases),
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await writeJson(outPath, payload)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
