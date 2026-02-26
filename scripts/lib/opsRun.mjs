import fs from "node:fs"
import path from "node:path"

const rootDir = process.cwd()

export const writeOpsSummary = ({ job, dateKey, payload }) => {
  const safeJob = String(job ?? "job").replace(/[^a-zA-Z0-9_-]/g, "_")
  const suffix = dateKey ? String(dateKey) : "latest"
  const filePath = path.join(
    rootDir,
    "logs",
    "ops",
    `${safeJob}_${suffix}_summary.json`,
  )
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return filePath
}

export const startOpsRun = async ({ prisma, job, dateKey, steps }) => {
  if (!prisma) {
    return null
  }
  const record = await prisma.opsRun.create({
    data: {
      job: String(job ?? "job"),
      dateKey: dateKey ?? null,
      startedAt: new Date(),
      steps: steps ?? null,
    },
  })
  return record
}

export const finishOpsRun = async ({ prisma, id, ok, notes, steps }) => {
  if (!prisma || !id) {
    return null
  }
  return prisma.opsRun.update({
    where: { id },
    data: {
      finishedAt: new Date(),
      ok: typeof ok === "boolean" ? ok : null,
      notes: notes ?? null,
      steps: steps ?? undefined,
    },
  })
}

export const updateDataSourceStatus = async ({
  prisma,
  key,
  status,
  detail,
}) => {
  if (!prisma || !key) {
    return null
  }
  return prisma.dataSourceStatus.upsert({
    where: { key: String(key) },
    create: {
      key: String(key),
      status,
      lastSyncAt: new Date(),
      detail: detail ?? null,
    },
    update: {
      status,
      lastSyncAt: new Date(),
      detail: detail ?? null,
    },
  })
}
