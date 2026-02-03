import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bindSignupDeviceLock,
  bindSignupIpLock,
  reserveSignupDeviceLock,
  reserveSignupIpLock,
} from "@/lib/security/signupLocks"

type IpLockRow = {
  ip: string
  status: string
  reservedAt?: Date
  reservedUntil?: Date
  boundAt?: Date
  userId?: string | null
  userAgent?: string | null
  signupCount?: number
}

type DeviceLockRow = {
  deviceIdHash: string
  status: string
  reservedAt?: Date
  reservedUntil?: Date
  boundAt?: Date
  userId?: string | null
}

const mocks = vi.hoisted(() => {
  const ipStore = new Map<string, IpLockRow>()
  const deviceStore = new Map<string, DeviceLockRow>()
  const prismaMock = {
    signupIpLock: {
      findUnique: vi.fn(async ({ where }: { where: { ip: string } }) => {
        return ipStore.get(where.ip) ?? null
      }),
      create: vi.fn(async ({ data }: { data: IpLockRow }) => {
        ipStore.set(data.ip, { ...data })
        return data
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { ip: string }
          data: Partial<IpLockRow>
        }) => {
          const existing = ipStore.get(where.ip) ?? ({} as IpLockRow)
          const updated = { ...existing, ...data }
          ipStore.set(where.ip, updated)
          return updated
        }
      ),
    },
    signupDeviceLock: {
      findUnique: vi.fn(
        async ({ where }: { where: { deviceIdHash: string } }) => {
          return deviceStore.get(where.deviceIdHash) ?? null
        }
      ),
      create: vi.fn(async ({ data }: { data: DeviceLockRow }) => {
        deviceStore.set(data.deviceIdHash, { ...data })
        return data
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { deviceIdHash: string }
          data: Partial<DeviceLockRow>
        }) => {
          const existing =
            deviceStore.get(where.deviceIdHash) ?? ({} as DeviceLockRow)
          const updated = { ...existing, ...data }
          deviceStore.set(where.deviceIdHash, updated)
          return updated
        }
      ),
    },
  }
  return { ipStore, deviceStore, prismaMock }
})

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prismaMock,
}))

describe("signup strict locks", () => {
  beforeEach(() => {
    mocks.ipStore.clear()
    mocks.deviceStore.clear()
  })

  it("allows 5 signups per IP", async () => {
    for (let i = 0; i < 5; i += 1) {
      const reserved = await reserveSignupIpLock({
        ipHash: "ip-1",
        userAgent: "ua",
        maxAccounts: 5,
      })
      expect(reserved.ok).toBe(true)
      await bindSignupIpLock({ ipHash: "ip-1", userId: `u${i + 1}` })
    }
  })

  it("blocks the 6th signup for the same IP", async () => {
    for (let i = 0; i < 5; i += 1) {
      const reserved = await reserveSignupIpLock({
        ipHash: "ip-1",
        userAgent: "ua",
        maxAccounts: 5,
      })
      expect(reserved.ok).toBe(true)
      await bindSignupIpLock({ ipHash: "ip-1", userId: `u${i + 1}` })
    }

    const sixth = await reserveSignupIpLock({
      ipHash: "ip-1",
      maxAccounts: 5,
    })
    expect(sixth.ok).toBe(false)
    expect(sixth.status).toBe("limit")
  })

  it("different IP has its own limit", async () => {
    const first = await reserveSignupIpLock({
      ipHash: "ip-a",
      maxAccounts: 5,
    })
    expect(first.ok).toBe(true)
    await bindSignupIpLock({ ipHash: "ip-a", userId: "u1" })

    const second = await reserveSignupIpLock({
      ipHash: "ip-b",
      maxAccounts: 5,
    })
    expect(second.ok).toBe(true)
  })

  it("blocks second signup on bound device", async () => {
    const first = await reserveSignupDeviceLock({ deviceIdHash: "dev-1" })
    expect(first.ok).toBe(true)

    await bindSignupDeviceLock({ deviceIdHash: "dev-1", userId: "u1" })

    const second = await reserveSignupDeviceLock({ deviceIdHash: "dev-1" })
    expect(second.ok).toBe(false)
    expect(second.status).toBe("bound")
  })
})
