import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

const CACHE_VERSION = 1
const CACHE_MAX_ENTRIES = 300

const stableStringify = (value) => {
  if (value === null || value === undefined) return "null"
  if (typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`
  }
  const keys = Object.keys(value).sort()
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
  return `{${pairs.join(",")}}`
}

const hashOf = (value) => crypto.createHash("sha256").update(stableStringify(value)).digest("hex")

const statSignature = async (absPath) => {
  try {
    const st = await fsp.stat(absPath)
    return {
      exists: true,
      size: Number(st.size) || 0,
      mtimeMs: Math.floor(Number(st.mtimeMs) || 0)
    }
  } catch {
    return {
      exists: false,
      size: 0,
      mtimeMs: 0
    }
  }
}

const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true })
}

const normalizeReuseMode = (value) => {
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "copy") return "copy"
  return "hardlink"
}

const cloneDirRecursive = async ({ srcDir, destDir, mode }) => {
  await ensureDir(destDir)
  const entries = await fsp.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      await cloneDirRecursive({ srcDir: src, destDir: dest, mode })
      continue
    }
    if (entry.isFile()) {
      if (mode === "hardlink") {
        try {
          await fsp.link(src, dest)
          continue
        } catch {
          // Cross-device or fs limitation: copy instead.
        }
      }
      await fsp.copyFile(src, dest)
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(src)
      await fsp.symlink(target, dest)
      continue
    }
  }
}

const getCachePath = (cwd) => path.join(cwd, "artifacts", "cache", "pipeline_cache.json")

export const parseBoolFlag = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue
  if (typeof value === "boolean") return value
  return new Set(["1", "true", "y", "yes", "on"]).has(String(value).toLowerCase())
}

export const pickObject = (obj, keys) => {
  const out = {}
  for (const key of keys ?? []) {
    if (Object.prototype.hasOwnProperty.call(obj ?? {}, key)) {
      out[key] = obj[key]
    }
  }
  return out
}

export const buildDataPathSignatures = async ({ cwd, dataPaths }) => {
  const out = {}
  for (const [key, relPath] of Object.entries(dataPaths ?? {})) {
    const absPath = path.resolve(cwd, relPath)
    out[key] = {
      path: relPath,
      ...(await statSignature(absPath))
    }
  }
  return out
}

export const buildFilesSignatureHash = async ({ cwd, files }) => {
  const rows = {}
  const list = Array.isArray(files) ? [...files] : []
  list.sort()
  for (const relPath of list) {
    const absPath = path.resolve(cwd, relPath)
    rows[relPath] = await statSignature(absPath)
  }
  return hashOf(rows)
}

export const listRelativeFilesRecursive = async ({ cwd, roots, filter }) => {
  const out = []
  const allow = typeof filter === "function" ? filter : () => true

  const visit = async (relPath) => {
    const absPath = path.resolve(cwd, relPath)
    let st = null
    try {
      st = await fsp.stat(absPath)
    } catch {
      return
    }

    if (st.isDirectory()) {
      const entries = await fsp.readdir(absPath, { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        await visit(path.join(relPath, entry.name))
      }
      return
    }

    if (st.isFile() && allow(relPath)) {
      out.push(relPath)
    }
  }

  for (const root of Array.isArray(roots) ? roots : []) {
    const relRoot = String(root ?? "").trim()
    if (!relRoot) continue
    await visit(relRoot)
  }

  out.sort()
  return out
}

export const buildStepKey = ({ step, payload }) => hashOf({ step, payload })

export const loadPipelineCache = async (cwd) => {
  const cachePath = getCachePath(cwd)
  if (!fs.existsSync(cachePath)) {
    return { cachePath, cache: { version: CACHE_VERSION, entries: {} } }
  }
  try {
    const raw = await fsp.readFile(cachePath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed?.version !== CACHE_VERSION || typeof parsed?.entries !== "object") {
      return { cachePath, cache: { version: CACHE_VERSION, entries: {} } }
    }
    return { cachePath, cache: parsed }
  } catch {
    return { cachePath, cache: { version: CACHE_VERSION, entries: {} } }
  }
}

export const savePipelineCache = async ({ cachePath, cache }) => {
  const entries = Object.entries(cache?.entries ?? {})
    .sort((a, b) => {
      const ta = Number(new Date(a[1]?.updatedAt ?? 0).getTime()) || 0
      const tb = Number(new Date(b[1]?.updatedAt ?? 0).getTime()) || 0
      return tb - ta
    })
    .slice(0, CACHE_MAX_ENTRIES)
  const compact = {
    version: CACHE_VERSION,
    entries: Object.fromEntries(entries)
  }
  await ensureDir(path.dirname(cachePath))
  await fsp.writeFile(cachePath, `${JSON.stringify(compact, null, 2)}\n`, "utf8")
}

export const tryReuseStep = async ({
  cache,
  key,
  runDir,
  stepDirName,
  requiredFile,
  reuseMode
}) => {
  const entry = cache?.entries?.[key]
  if (!entry?.stepDirAbs) return null
  const srcDir = String(entry.stepDirAbs)
  const srcRequired = path.join(srcDir, requiredFile)
  if (!fs.existsSync(srcRequired)) return null

  const destDir = path.join(runDir, stepDirName)
  await fsp.rm(destDir, { recursive: true, force: true })
  await ensureDir(path.dirname(destDir))
  const mode = normalizeReuseMode(reuseMode)
  await cloneDirRecursive({
    srcDir,
    destDir,
    mode
  })
  return {
    sourceRunId: entry.runId ?? null,
    sourceDir: srcDir,
    reuseMode: mode
  }
}

export const updateStepCacheEntry = ({
  cache,
  key,
  runDir,
  runId,
  stepDirName,
  requiredFile
}) => {
  const stepDirAbs = path.join(runDir, stepDirName)
  if (!fs.existsSync(path.join(stepDirAbs, requiredFile))) return
  if (!cache.entries || typeof cache.entries !== "object") cache.entries = {}
  cache.entries[key] = {
    runId,
    stepDirAbs,
    requiredFile,
    updatedAt: new Date().toISOString()
  }
}
