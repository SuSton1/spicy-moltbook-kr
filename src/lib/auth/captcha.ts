import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
type CaptchaRecord = {
  id: string
  ipHash: string
  answerHash: string
  expiresAt: Date
  attempts: number
}

type CaptchaClient = {
  captchaChallenge: {
    create: (args: {
      data: Omit<CaptchaRecord, "id"> & { id?: string }
    }) => Promise<CaptchaRecord>
    findUnique: (args: { where: { id: string } }) => Promise<CaptchaRecord | null>
    update: (args: {
      where: { id: string }
      data: { attempts?: { increment: number } }
    }) => Promise<CaptchaRecord | null>
    delete: (args: { where: { id: string } }) => Promise<CaptchaRecord | null>
  }
}

const MAX_ATTEMPTS = 5
const memoryChallenges = new Map<string, CaptchaRecord>()

const isMissingTable = (error: unknown) =>
  process.env.E2E_TEST === "1" &&
  (error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null && "code" in error)) &&
  (error as { code?: string }).code === "P2021"

function hashAnswer(value: string) {
  const secret = process.env.IP_HASH_SECRET ?? process.env.IP_HASH_SALT ?? ""
  return crypto
    .createHash("sha256")
    .update(`${value}|${secret}`)
    .digest("hex")
}

function makeSvg(text: string) {
  const noise1 = Math.floor(Math.random() * 20) + 5
  const noise2 = Math.floor(Math.random() * 20) + 10
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="140" height="44" viewBox="0 0 140 44">
  <rect width="140" height="44" rx="8" fill="#F3F5FB"/>
  <path d="M6 ${noise1} H134" stroke="#D5DBEF" stroke-width="2"/>
  <path d="M6 ${noise2} H134" stroke="#E3E8F5" stroke-width="2"/>
  <text x="70" y="28" text-anchor="middle" font-size="20" font-family="sans-serif" fill="#223A70" letter-spacing="3">${text}</text>
</svg>`.trim()
}

export async function createCaptcha(
  prisma: CaptchaClient,
  ipHash: string,
  answerOverride?: string
) {
  const ttlMinutes = Number.parseInt(
    process.env.CAPTCHA_TTL_MINUTES ?? "5",
    10
  )
  const testCode =
    process.env.NODE_ENV === "test" || process.env.E2E_TEST === "1"
      ? process.env.CAPTCHA_TEST_CODE
      : undefined
  const testId = testCode
    ? process.env.CAPTCHA_TEST_ID ?? `test-captcha-${testCode}`
    : undefined
  const answer =
    testCode ?? answerOverride ?? String(Math.floor(10000 + Math.random() * 90000))
  const answerHash = hashAnswer(answer)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)

  if (testId) {
    try {
      await prisma.captchaChallenge
        .delete({ where: { id: testId } })
        .catch(() => null)
    } catch (error) {
      if (!isMissingTable(error)) throw error
      memoryChallenges.delete(testId)
    }
  }
  try {
    const record = await prisma.captchaChallenge.create({
      data: {
        ...(testId ? { id: testId } : {}),
        ipHash,
        answerHash,
        expiresAt,
        attempts: 0,
      },
    })

    return {
      captchaId: record.id,
      svg: makeSvg(answer),
      expiresAt,
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error
    const id = testId ?? crypto.randomUUID()
    const record = {
      id,
      ipHash,
      answerHash,
      expiresAt,
      attempts: 0,
    }
    memoryChallenges.set(id, record)
    return {
      captchaId: record.id,
      svg: makeSvg(answer),
      expiresAt,
    }
  }
}

export async function verifyCaptcha({
  prisma,
  ipHash,
  captchaId,
  text,
  consume,
}: {
  prisma: CaptchaClient
  ipHash: string
  captchaId: string
  text: string
  consume: boolean
}) {
  let record: CaptchaRecord | null = null
  try {
    record = await prisma.captchaChallenge.findUnique({
      where: { id: captchaId },
    })
  } catch (error) {
    if (!isMissingTable(error)) throw error
    record = memoryChallenges.get(captchaId) ?? null
  }

  if (!record || record.ipHash !== ipHash) {
    return { ok: false, error: "CAPTCHA_NOT_FOUND" }
  }

  const now = new Date()
  if (record.expiresAt <= now) {
    try {
      await prisma.captchaChallenge.delete({ where: { id: record.id } })
    } catch (error) {
      if (!isMissingTable(error)) throw error
      memoryChallenges.delete(record.id)
    }
    return { ok: false, error: "CAPTCHA_EXPIRED" }
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "CAPTCHA_LOCKED" }
  }

  const normalized = text.replace(/\D/g, "").trim()
  if (!normalized) {
    return { ok: false, error: "CAPTCHA_REQUIRED" }
  }

  const answerHash = hashAnswer(normalized)
  if (answerHash !== record.answerHash) {
    try {
      await prisma.captchaChallenge.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      })
    } catch (error) {
      if (!isMissingTable(error)) throw error
      memoryChallenges.set(record.id, {
        ...record,
        attempts: record.attempts + 1,
      })
    }
    return { ok: false, error: "CAPTCHA_INVALID" }
  }

  if (consume) {
    try {
      await prisma.captchaChallenge.delete({ where: { id: record.id } })
    } catch (error) {
      if (!isMissingTable(error)) throw error
      memoryChallenges.delete(record.id)
    }
  }

  return { ok: true }
}
