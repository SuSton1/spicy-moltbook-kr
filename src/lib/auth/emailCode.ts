import crypto from "node:crypto"
type EmailCodeRecord = {
  id: string
  email: string
  purpose: string
  codeHash: string
  expiresAt: Date
  consumedAt: Date | null
  attempts: number
  ipHash: string | null
}

type EmailCodeClient = {
  emailCode: {
    updateMany: (args: {
      where: { email: string; purpose: string; consumedAt: null }
      data: { consumedAt: Date }
    }) => Promise<{ count: number }>
    create: (args: {
      data: Omit<EmailCodeRecord, "id" | "consumedAt">
    }) => Promise<EmailCodeRecord>
    findFirst: (args: {
      where: { email: string; purpose: string; consumedAt: null }
      orderBy: { createdAt: "desc" }
    }) => Promise<EmailCodeRecord | null>
    update: (args: {
      where: { id: string }
      data: { attempts?: { increment: number }; consumedAt?: Date }
    }) => Promise<EmailCodeRecord | null>
  }
}

const MAX_ATTEMPTS = 5

function hashCode(code: string) {
  const secret = process.env.IP_HASH_SECRET ?? process.env.IP_HASH_SALT ?? ""
  return crypto
    .createHash("sha256")
    .update(`${code}|${secret}`)
    .digest("hex")
}

export async function createEmailCode({
  prisma,
  email,
  purpose,
  ipHash,
}: {
  prisma: EmailCodeClient
  email: string
  purpose: string
  ipHash?: string | null
}) {
  const ttlMinutes = Number.parseInt(
    process.env.EMAIL_CODE_TTL_MINUTES ?? "10",
    10
  )
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = hashCode(code)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)

  await prisma.emailCode.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  })

  await prisma.emailCode.create({
    data: {
      email,
      purpose,
      codeHash,
      expiresAt,
      ipHash: ipHash ?? null,
      attempts: 0,
    },
  })

  return { code, expiresAt }
}

export async function verifyEmailCode({
  prisma,
  email,
  purpose,
  code,
}: {
  prisma: EmailCodeClient
  email: string
  purpose: string
  code: string
}) {
  const record = await prisma.emailCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  })

  if (!record) {
    return { ok: false, error: "CODE_NOT_FOUND" }
  }

  const now = new Date()
  if (record.expiresAt <= now) {
    return { ok: false, error: "CODE_EXPIRED" }
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "CODE_LOCKED" }
  }

  const hash = hashCode(code.trim())
  if (hash !== record.codeHash) {
    await prisma.emailCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, error: "CODE_INVALID" }
  }

  await prisma.emailCode.update({
    where: { id: record.id },
    data: { consumedAt: now },
  })

  return { ok: true }
}
