import crypto from "node:crypto"
import path from "node:path"
import { readFile } from "node:fs/promises"

import { ensureDir, pathExists, readJson, writeJson } from "./io.mjs"

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex")

export const hashFileSha1 = async (filePath) => {
  const safePath = String(filePath ?? "").trim()
  if (!safePath || !pathExists(safePath)) return null
  const buffer = await readFile(safePath)
  return sha1(buffer)
}

export const hashJsonStableSha1 = (value) => sha1(JSON.stringify(value ?? null))

export const resolveChampionBundlePath = ({ outDir, tag = "champion_bundle.json" }) =>
  path.join(outDir, tag)

export const readChampionBundle = async (bundlePath) => {
  const bundle = await readJson(bundlePath, null)
  if (!bundle || typeof bundle !== "object") {
    throw new Error(`Champion bundle not readable: ${bundlePath}`)
  }
  return bundle
}

export const writeChampionBundle = async ({ bundlePath, bundle }) => {
  await ensureDir(path.dirname(bundlePath))
  await writeJson(bundlePath, bundle)
  return bundlePath
}
