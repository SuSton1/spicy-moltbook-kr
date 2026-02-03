import type { Prisma } from "@prisma/client"
import { getIpHashSecret } from "@/lib/security/ipHash"

export class SignupConfigError extends Error {
  code = "SERVER_CONFIG_MISSING" as const
  missing: string[]

  constructor(missing: string[]) {
    super("Missing required configuration")
    this.missing = missing
  }
}

export class SignupSchemaError extends Error {
  code = "DB_MIGRATION_MISSING" as const

  constructor(message: string) {
    super(message)
  }
}

export function validateSignupConfig() {
  if (process.env.NODE_ENV !== "production") {
    return
  }

  const missing: string[] = []
  if (!process.env.DEVICE_HASH_SALT) missing.push("DEVICE_HASH_SALT")
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    missing.push("AUTH_SECRET")
  }
  if (!process.env.APP_ORIGIN) missing.push("APP_ORIGIN")
  if (process.env.TRUST_PROXY === undefined) missing.push("TRUST_PROXY")
  if (!getIpHashSecret()) missing.push("IP_HASH_SECRET")

  if (missing.length > 0) {
    throw new SignupConfigError(missing)
  }
}

export function isMissingTableError(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const maybe = error as { code?: string; message?: string }
  if (maybe.code === "P2021") return true
  const message = maybe.message?.toLowerCase() ?? ""
  return (
    message.includes("relation") && message.includes("does not exist")
  )
}

export async function checkSignupSchema(prisma: {
  signupIpLock: { count: (args: { take: number }) => Promise<number> }
  signupDeviceLock: { count: (args: { take: number }) => Promise<number> }
  recoveryCode: { count: (args: { take: number }) => Promise<number> }
}) {
  try {
    await prisma.signupIpLock.count({ take: 1 })
    await prisma.signupDeviceLock.count({ take: 1 })
    await prisma.recoveryCode.count({ take: 1 })
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new SignupSchemaError("Signup tables missing")
    }
    throw error
  }
}

export function isPrismaKnownError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  if (typeof error !== "object" || error === null) return false
  return "code" in error
}
