import { prisma } from "@/lib/prisma"

const DEFAULT_RESERVATION_MINUTES = 10

export async function reserveSignupIpLock({
  ipHash,
  reservationMinutes = DEFAULT_RESERVATION_MINUTES,
  userAgent,
  maxAccounts = 1,
}: {
  ipHash: string
  reservationMinutes?: number
  userAgent?: string | null
  maxAccounts?: number
}) {
  const now = new Date()
  const reservedUntil = new Date(
    now.getTime() + reservationMinutes * 60 * 1000
  )

  const existing = await prisma.signupIpLock.findUnique({
    where: { ip: ipHash },
  })

  const getEffectiveCount = (count: number | null | undefined, userId?: string | null) =>
    count && count > 0 ? count : userId ? 1 : 0

  if (!existing) {
    await prisma.signupIpLock.create({
      data: {
        ip: ipHash,
        status: "reserved",
        reservedUntil,
        userAgent: userAgent ?? null,
        signupCount: 0,
      },
    })
    return { ok: true, status: "reserved" as const }
  }

  const effectiveCount = getEffectiveCount(existing.signupCount, existing.userId)
  if (effectiveCount >= maxAccounts) {
    return { ok: false, status: "limit" as const }
  }

  if (existing.reservedUntil > now) {
    return { ok: false, status: "reserved" as const }
  }

  await prisma.signupIpLock.update({
    where: { ip: ipHash },
    data: {
      status: "reserved",
      reservedAt: now,
      reservedUntil,
      userAgent: userAgent ?? null,
    },
  })
  return { ok: true, status: "reserved" as const }
}

export async function bindSignupIpLock({
  ipHash,
  userId,
  userAgent,
}: {
  ipHash: string
  userId: string
  userAgent?: string | null
}) {
  const now = new Date()
  const existing = await prisma.signupIpLock.findUnique({
    where: { ip: ipHash },
  })
  const existingCount = existing?.signupCount ?? 0
  const effectiveCount =
    existingCount > 0 ? existingCount : existing?.userId ? 1 : 0
  const nextCount = effectiveCount + 1

  if (!existing) {
    await prisma.signupIpLock.create({
      data: {
        ip: ipHash,
        status: "bound",
        userId,
        boundAt: now,
        reservedUntil: now,
        userAgent: userAgent ?? null,
        signupCount: nextCount,
      },
    })
    return
  }

  await prisma.signupIpLock.update({
    where: { ip: ipHash },
    data: {
      status: "bound",
      userId,
      boundAt: now,
      reservedUntil: now,
      userAgent: userAgent ?? null,
      signupCount: nextCount,
    },
  })
}

export async function reserveSignupDeviceLock({
  deviceIdHash,
  reservationMinutes = DEFAULT_RESERVATION_MINUTES,
}: {
  deviceIdHash: string
  reservationMinutes?: number
}) {
  const now = new Date()
  const reservedUntil = new Date(
    now.getTime() + reservationMinutes * 60 * 1000
  )

  const existing = await prisma.signupDeviceLock.findUnique({
    where: { deviceIdHash },
  })

  if (!existing) {
    await prisma.signupDeviceLock.create({
      data: {
        deviceIdHash,
        status: "reserved",
        reservedUntil,
      },
    })
    return { ok: true, status: "reserved" as const }
  }

  if (existing.status === "bound") {
    return { ok: false, status: "bound" as const }
  }

  if (existing.reservedUntil > now) {
    return { ok: false, status: "reserved" as const }
  }

  await prisma.signupDeviceLock.update({
    where: { deviceIdHash },
    data: { status: "reserved", reservedAt: now, reservedUntil },
  })
  return { ok: true, status: "reserved" as const }
}

export async function bindSignupDeviceLock({
  deviceIdHash,
  userId,
}: {
  deviceIdHash: string
  userId: string
}) {
  const now = new Date()
  await prisma.signupDeviceLock.update({
    where: { deviceIdHash },
    data: {
      status: "bound",
      userId,
      boundAt: now,
      reservedUntil: now,
    },
  })
}
