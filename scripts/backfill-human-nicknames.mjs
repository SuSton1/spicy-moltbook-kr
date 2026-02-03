import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g
const RESERVED_CONTAINS = [
  "관리자",
  "운영자",
  "admin",
  "administrator",
  "mod",
  "moderator",
  "system",
  "agent",
]
const RESERVED_PREFIX = ["휴먼", "에이전트"]
const PROFANITY_KEYWORDS = ["씨발", "시발", "병신", "좆", "ㅅㅂ"]
const ALLOWED_REGEX = /^[a-z0-9_가-힣 ]+$/

const BATCH_SIZE = 500
const PLACEHOLDER_PREFIX = "휴먼"
const PLACEHOLDER_TRIES = 20

function normalizeNickname(raw) {
  const cleaned = raw.replace(ZERO_WIDTH_REGEX, "")
  const normalized = cleaned.normalize("NFKC")
  return normalized.trim().replace(/\s+/g, " ").toLowerCase()
}

function normalizeOriginal(raw) {
  const cleaned = raw.replace(ZERO_WIDTH_REGEX, "")
  const normalized = cleaned.normalize("NFKC")
  return normalized.trim().replace(/\s+/g, " ")
}

function isTempNickname(value) {
  return new RegExp(`^${PLACEHOLDER_PREFIX}\\d{5}$`).test(value)
}

function validateNickname(raw) {
  const original = normalizeOriginal(raw)
  const normalized = normalizeNickname(raw)
  if (!normalized) return { ok: false }
  if (normalized.length < 2 || normalized.length > 12) return { ok: false }
  if (!ALLOWED_REGEX.test(normalized)) return { ok: false }
  if (normalized === "h" || normalized === "a") return { ok: false }
  if (RESERVED_PREFIX.some((value) => normalized.startsWith(value))) return { ok: false }
  if (/휴먼#\d+/.test(normalized)) return { ok: false }
  if (RESERVED_CONTAINS.some((value) => normalized.includes(value))) return { ok: false }
  if (PROFANITY_KEYWORDS.some((value) => normalized.includes(value))) {
    return { ok: false }
  }
  return { ok: true, original, normalized }
}

async function claimNickname({ userId, nickname, normalized, temp }) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.nicknameRegistry.findUnique({
      where: { userId_kind: { userId, kind: "HUMAN" } },
    })
    if (existing) {
      await tx.nicknameRegistry.update({
        where: { id: existing.id },
        data: { nickname, normalizedNickname: normalized },
      })
    } else {
      await tx.nicknameRegistry.create({
        data: {
          userId,
          kind: "HUMAN",
          nickname,
          normalizedNickname: normalized,
        },
      })
    }
    await tx.user.update({
      where: { id: userId },
      data: { humanNickname: nickname, humanNicknameTemp: temp },
    })
  })
}

async function assignPlaceholder(userId) {
  for (let i = 0; i < PLACEHOLDER_TRIES; i += 1) {
    const suffix = Math.floor(10000 + Math.random() * 90000)
    const nickname = `${PLACEHOLDER_PREFIX}${suffix}`
    const normalized = normalizeNickname(nickname)
    try {
      await claimNickname({ userId, nickname, normalized, temp: true })
      return true
    } catch (error) {
      if (error?.code === "P2002") {
        continue
      }
      throw error
    }
  }
  return false
}

async function main() {
  let lastId = null
  let processed = 0
  let backfilled = 0
  let placeholders = 0
  let skipped = 0

  while (true) {
    const users = await prisma.user.findMany({
      where: { humanNickname: null },
      take: BATCH_SIZE,
      ...(lastId
        ? {
            cursor: { id: lastId },
            skip: 1,
          }
        : {}),
      orderBy: { id: "asc" },
      select: { id: true, nickname: true },
    })

    if (!users.length) break

    for (const user of users) {
      processed += 1
      const existing = await prisma.nicknameRegistry.findUnique({
        where: { userId_kind: { userId: user.id, kind: "HUMAN" } },
      })
      if (existing) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            humanNickname: existing.nickname,
            humanNicknameTemp: isTempNickname(existing.nickname),
          },
        })
        skipped += 1
        continue
      }

      const legacy = typeof user.nickname === "string" ? user.nickname : ""
      const validation = legacy ? validateNickname(legacy) : { ok: false }
      if (validation.ok) {
        try {
          await claimNickname({
            userId: user.id,
            nickname: validation.original,
            normalized: validation.normalized,
            temp: false,
          })
          backfilled += 1
        } catch (error) {
          if (error?.code === "P2002") {
            const ok = await assignPlaceholder(user.id)
            if (ok) {
              placeholders += 1
            }
          } else {
            throw error
          }
        }
      } else {
        const ok = await assignPlaceholder(user.id)
        if (ok) {
          placeholders += 1
        }
      }
    }

    lastId = users[users.length - 1]?.id ?? null
  }

  console.log(
    `backfill complete: processed=${processed} backfilled=${backfilled} placeholders=${placeholders} skipped=${skipped}`
  )
}

main()
  .catch((error) => {
    console.error("backfill failed")
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
