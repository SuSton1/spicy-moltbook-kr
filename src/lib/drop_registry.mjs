import path from "node:path"

import { pathExists, readJson, writeJson } from "./io.mjs"

const normalizeIdList = (values) => {
  const out = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value ?? "").trim()
    if (!id) continue
    out.add(id)
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b))
}

export const createEmptyDropRegistry = ({ lineageKey = null } = {}) => ({
  version: 1,
  lineageKey: String(lineageKey ?? "").trim() || null,
  updatedAt: null,
  sessionDropTemplateIds: [],
  lineageDropSoftTemplateIds: [],
  lineageDropHardTemplateIds: [],
  globalHardBanTemplateIds: []
})

export const readDropRegistry = async ({ filePath, lineageKey = null }) => {
  const safePath = String(filePath ?? "").trim()
  if (!safePath || !pathExists(safePath)) {
    return createEmptyDropRegistry({ lineageKey })
  }
  const raw = await readJson(safePath, null)
  if (Array.isArray(raw)) {
    return {
      ...createEmptyDropRegistry({ lineageKey }),
      updatedAt: null,
      lineageDropSoftTemplateIds: normalizeIdList(raw)
    }
  }
  return {
    ...createEmptyDropRegistry({ lineageKey }),
    ...(raw && typeof raw === "object" ? raw : {}),
    lineageKey:
      String(raw?.lineageKey ?? lineageKey ?? "").trim() || null,
    sessionDropTemplateIds: normalizeIdList(raw?.sessionDropTemplateIds),
    lineageDropSoftTemplateIds: normalizeIdList(raw?.lineageDropSoftTemplateIds),
    lineageDropHardTemplateIds: normalizeIdList(raw?.lineageDropHardTemplateIds),
    globalHardBanTemplateIds: normalizeIdList(raw?.globalHardBanTemplateIds)
  }
}

export const resolveEffectiveDropTemplateIds = (registry) => {
  const ids = new Set()
  for (const key of [
    "sessionDropTemplateIds",
    "lineageDropSoftTemplateIds",
    "lineageDropHardTemplateIds",
    "globalHardBanTemplateIds"
  ]) {
    for (const id of registry?.[key] ?? []) ids.add(String(id))
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b))
}

export const writeDropRegistry = async ({ filePath, registry }) => {
  const next = {
    ...createEmptyDropRegistry({ lineageKey: registry?.lineageKey }),
    ...(registry && typeof registry === "object" ? registry : {}),
    updatedAt: new Date().toISOString(),
    sessionDropTemplateIds: normalizeIdList(registry?.sessionDropTemplateIds),
    lineageDropSoftTemplateIds: normalizeIdList(registry?.lineageDropSoftTemplateIds),
    lineageDropHardTemplateIds: normalizeIdList(registry?.lineageDropHardTemplateIds),
    globalHardBanTemplateIds: normalizeIdList(registry?.globalHardBanTemplateIds)
  }
  await writeJson(filePath, next)
  return next
}

export const resolveDropRegistrySnapshotPath = (registryPath, fallbackName = "permanent_drop_template_ids.json") =>
  path.join(path.dirname(registryPath), fallbackName)
