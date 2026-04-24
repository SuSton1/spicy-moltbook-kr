import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const parseArgs = (argv) => {
  const flags = {}
  for (const token of argv ?? []) {
    if (!String(token).startsWith("--")) continue
    const body = String(token).slice(2)
    const i = body.indexOf("=")
    if (i >= 0) {
      flags[body.slice(0, i)] = body.slice(i + 1)
    } else {
      flags[body] = "true"
    }
  }
  return flags
}

const toBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue
  return new Set(["1", "true", "y", "yes", "on"]).has(String(value).toLowerCase())
}

const readJson = async (filePath, defaultValue) => {
  try {
    const raw = await fsp.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return defaultValue
  }
}

const writeJson = async (filePath, value) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const listRunDirs = async (runsRoot) => {
  if (!fs.existsSync(runsRoot)) return []
  const entries = await fsp.readdir(runsRoot, { withFileTypes: true })
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const abs = path.join(runsRoot, entry.name)
    const st = await fsp.stat(abs)
    dirs.push({
      name: entry.name,
      abs,
      mtimeMs: Number(st.mtimeMs) || 0
    })
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return dirs
}

const cleanupCache = async ({ cachePath, apply, deletedRunAbsSet }) => {
  const cache = await readJson(cachePath, null)
  if (!cache || typeof cache.entries !== "object") {
    return { cacheUpdated: false, before: 0, after: 0 }
  }
  const entries = Object.entries(cache.entries)
  const before = entries.length
  const kept = []
  for (const [key, value] of entries) {
    const stepDirAbs = String(value?.stepDirAbs ?? "")
    if (!stepDirAbs) continue
    if (deletedRunAbsSet.has(path.dirname(stepDirAbs))) continue
    if (!fs.existsSync(stepDirAbs)) continue
    kept.push([key, value])
  }
  const next = {
    version: cache.version ?? 1,
    entries: Object.fromEntries(kept)
  }
  if (apply) {
    await writeJson(cachePath, next)
  }
  return {
    cacheUpdated: apply,
    before,
    after: kept.length
  }
}

const main = async () => {
  const flags = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const keep = Math.max(1, Number(flags.keep ?? 40) || 40)
  const apply = toBool(flags.apply, false)
  const runsRoot = path.resolve(cwd, String(flags["runs-root"] ?? "artifacts/runs"))
  const pruneCache = toBool(flags["prune-cache"], true)
  const cachePath = path.resolve(cwd, "artifacts/cache/pipeline_cache.json")

  const dirs = await listRunDirs(runsRoot)
  const keepDirs = dirs.slice(0, keep)
  const deleteDirs = dirs.slice(keep)

  if (apply) {
    for (const row of deleteDirs) {
      await fsp.rm(row.abs, { recursive: true, force: true })
    }
  }

  const deletedRunAbsSet = new Set(deleteDirs.map((row) => row.abs))
  const cacheResult = pruneCache
    ? await cleanupCache({ cachePath, apply, deletedRunAbsSet })
    : { cacheUpdated: false, before: 0, after: 0 }

  console.log(
    JSON.stringify(
      {
        runsRoot,
        keep,
        apply,
        totalRuns: dirs.length,
        keptRuns: keepDirs.length,
        deleteCandidates: deleteDirs.length,
        deletedNames: deleteDirs.map((row) => row.name),
        cache: cacheResult
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error))
  process.exit(1)
})
