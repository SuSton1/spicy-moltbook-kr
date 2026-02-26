import process from "node:process"
import dotenv from "dotenv"

import { PrismaClient } from "@prisma/client"

import { buildRetentionPlan } from "./lib.mjs"

const rootDir = process.cwd()

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  candidates.forEach((file) => {
    dotenv.config({ path: `${rootDir}/${file}` })
  })
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => {
    const match = args.find((arg) => arg.startsWith(`${key}=`))
    return match ? match.slice(key.length + 1) : null
  }
  const runId = String(getValue("--runId") ?? "").trim()
  const keepLastRaw = Number(getValue("--keepLast"))
  const keepLast = Number.isFinite(keepLastRaw) ? keepLastRaw : 5
  return { runId, keepLast }
}

const mergeEntries = (entries) => {
  const map = new Map()
  for (const entry of entries ?? []) {
    const track = String(entry.track ?? "").trim()
    const label = String(entry.versionLabel ?? "").trim()
    if (!track || !label) {
      continue
    }
    const key = `${track}:${label}`
    const ts = entry.createdAt ? new Date(entry.createdAt).getTime() : 0
    const prev = map.get(key)
    if (!prev || ts > prev.createdAt) {
      map.set(key, { track, versionLabel: label, createdAt: ts })
    }
  }
  return Array.from(map.values())
}

const run = async () => {
  loadLocalEnv()
  const args = parseArgs()
  if (!args.runId) {
    throw new Error("Missing --runId")
  }

  const prisma = new PrismaClient()
  const runRow = await prisma.autoSearchRun.findUnique({
    where: { runId: args.runId },
    select: { best: true },
  })

  const activeRows = await prisma.activeStrategy.findMany({
    select: {
      activePatternLabel: true,
      activePolicyLabel: true,
    },
  })
  const keepLabels = new Set()
  for (const row of activeRows) {
    const pattern = String(row.activePatternLabel ?? "").trim()
    const policy = String(row.activePolicyLabel ?? "").trim()
    if (pattern) keepLabels.add(pattern)
    if (policy) keepLabels.add(policy)
  }

  const bestTracks = runRow?.best?.tracks ?? {}
  for (const entry of Object.values(bestTracks)) {
    const pattern = String(entry?.patternVersionLabel ?? "").trim()
    const policy = String(entry?.policyVersionLabel ?? "").trim()
    if (pattern) keepLabels.add(pattern)
    if (policy) keepLabels.add(policy)
  }

  const [ruleRows, shapeRows, policyRows] = await Promise.all([
    prisma.patternRule.findMany({
      where: { versionLabel: { startsWith: "autosearch:" } },
      select: { track: true, versionLabel: true, createdAt: true },
    }),
    prisma.patternShape.findMany({
      where: { versionLabel: { startsWith: "autosearch:" } },
      select: { track: true, versionLabel: true, createdAt: true },
    }),
    prisma.levelPolicy.findMany({
      where: { versionLabel: { startsWith: "autosearch:" } },
      select: { track: true, versionLabel: true, createdAt: true },
    }),
  ])

  const stagingEntries = mergeEntries([
    ...ruleRows,
    ...shapeRows,
    ...policyRows,
  ])

  const plan = buildRetentionPlan({
    stagingEntries,
    keepLabels: Array.from(keepLabels),
    keepLast: args.keepLast,
  })

  const deleteLabels = plan.deleteLabels
  let deletedRules = 0
  let deletedShapes = 0
  let deletedPolicies = 0
  if (deleteLabels.length) {
    const [rules, shapes, policies] = await Promise.all([
      prisma.patternRule.deleteMany({
        where: { versionLabel: { in: deleteLabels } },
      }),
      prisma.patternShape.deleteMany({
        where: { versionLabel: { in: deleteLabels } },
      }),
      prisma.levelPolicy.deleteMany({
        where: { versionLabel: { in: deleteLabels } },
      }),
    ])
    deletedRules = rules.count
    deletedShapes = shapes.count
    deletedPolicies = policies.count
  }

  await prisma.$disconnect()

  const summary = {
    runId: args.runId,
    keepLast: args.keepLast,
    stagingCount: stagingEntries.length,
    deleteCount: deleteLabels.length,
    deleted: {
      rules: deletedRules,
      shapes: deletedShapes,
      policies: deletedPolicies,
    },
  }
  console.log(JSON.stringify(summary, null, 2))
}

run().catch((error) => {
  console.error("[autosearch-retention] failed", error)
  process.exitCode = 1
})
