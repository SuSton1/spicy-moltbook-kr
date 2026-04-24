import fs from "node:fs/promises"
import path from "node:path"

const normalizeString = (value) => {
  const text = String(value ?? "").trim()
  return text.length > 0 ? text : null
}

const parseArgs = (argv) => {
  const flags = new Map()
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue
    }
    const eq = arg.indexOf("=")
    if (eq === -1) {
      flags.set(arg.slice(2), "true")
      continue
    }
    flags.set(arg.slice(2, eq), arg.slice(eq + 1))
  }
  return flags
}

const getFlag = (flags, name) => normalizeString(flags.get(name))

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

const parseLineIdFromNote = (value) => {
  const note = normalizeString(value)
  if (!note) {
    return null
  }
  const match = note.match(/(?:^|\s)line=([A-Za-z0-9_.-]+)/)
  return normalizeString(match?.[1] ?? null)
}

const resolveExpectedSurface = (manifest) =>
  normalizeString(manifest?.surface) ??
  normalizeString(manifest?.contextSurface) ??
  normalizeString(manifest?.metadata?.surface) ??
  normalizeString(manifest?.metadata?.contextSurface) ??
  normalizeString(manifest?.metadata?.sourceCatalogMetadata?.surfaceName) ??
  normalizeString(manifest?.metadata?.sourceCatalogMetadata?.rejectionSummary?.surfaceName) ??
  normalizeString(manifest?.metadata?.sourceCatalogMetadata?.tokenizer?.surface) ??
  null

const resolveExpectedLineId = (manifest) =>
  normalizeString(manifest?.lineId) ??
  normalizeString(manifest?.metadata?.lineId) ??
  parseLineIdFromNote(manifest?.note) ??
  parseLineIdFromNote(manifest?.curatedNote) ??
  parseLineIdFromNote(manifest?.metadata?.curatedNote) ??
  null

const resolveActualSurface = (summary) =>
  normalizeString(summary?.perfectPrototypeFeatureSurface) ??
  normalizeString(summary?.contextSurface) ??
  normalizeString(summary?.perfectPrototypeBaselineContract?.contextSurface) ??
  null

const resolveActualLineId = (summary) =>
  normalizeString(summary?.baselineLineId) ??
  normalizeString(summary?.perfectPrototypeBaselineContract?.lineId) ??
  null

const main = async () => {
  const flags = parseArgs(process.argv.slice(2))
  const manifestPath = getFlag(flags, "manifest")
  const stepBSummaryPath = getFlag(flags, "stepb-summary")
  const catalogPath = getFlag(flags, "catalog")
  const configPath = getFlag(flags, "config")

  if (!manifestPath || !stepBSummaryPath) {
    throw new Error(
      "Usage: node tools/assert_stepb_after_close_surface_integrity.mjs --manifest=<manifest.json> --stepb-summary=<summary.json> [--catalog=<catalog.json>] [--config=<config.json>]",
    )
  }

  const [manifest, summary] = await Promise.all([readJson(manifestPath), readJson(stepBSummaryPath)])

  const expectedSurface = resolveExpectedSurface(manifest)
  const expectedLineId = resolveExpectedLineId(manifest)
  const actualSurface = resolveActualSurface(summary)
  const actualLineId = resolveActualLineId(summary)

  if (!expectedSurface) {
    throw new Error(`after-close surface integrity check could not resolve expected surface from manifest: ${manifestPath}`)
  }
  if (!actualSurface) {
    throw new Error(
      `after-close surface integrity check could not resolve actual Step-B surface from summary: ${stepBSummaryPath}`,
    )
  }
  if (expectedSurface !== actualSurface) {
    throw new Error(
      [
        "Step-B after-close surface mismatch.",
        `catalogSurface=${expectedSurface}`,
        `stepBSurface=${actualSurface}`,
        catalogPath ? `catalog=${catalogPath}` : null,
        `manifest=${manifestPath}`,
        `stepBSummary=${stepBSummaryPath}`,
        configPath ? `config=${configPath}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
  }

  if (expectedLineId && actualLineId && expectedLineId !== actualLineId) {
    throw new Error(
      [
        "Step-B after-close baseline line mismatch.",
        `catalogLineId=${expectedLineId}`,
        `stepBLineId=${actualLineId}`,
        catalogPath ? `catalog=${catalogPath}` : null,
        `manifest=${manifestPath}`,
        `stepBSummary=${stepBSummaryPath}`,
        configPath ? `config=${configPath}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
  }

  const result = {
    ok: true,
    expectedSurface,
    actualSurface,
    expectedLineId,
    actualLineId,
    manifestPath: path.resolve(manifestPath),
    stepBSummaryPath: path.resolve(stepBSummaryPath),
    catalogPath: catalogPath ? path.resolve(catalogPath) : null,
    configPath: configPath ? path.resolve(configPath) : null,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
