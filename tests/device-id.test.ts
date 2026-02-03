import { afterEach, describe, expect, it, vi } from "vitest"

const cookiesMock = vi.fn()

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

type CookieStore = {
  get: (name: string) => { value: string } | undefined
  set: (name: string, value: string, options: Record<string, unknown>) => void
}

const createStore = (initial: Record<string, string>): CookieStore => {
  const state = { ...initial }
  return {
    get: (name: string) => (state[name] ? { value: state[name] } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state[name] = value
      void options
    },
  }
}

const setNodeEnv = (value: string) => {
  ;(process.env as Record<string, string>).NODE_ENV = value
}

const loadDeviceIdModule = async (nodeEnv: string) => {
  vi.resetModules()
  setNodeEnv(nodeEnv)
  return await import("@/lib/security/deviceId")
}

afterEach(() => {
  cookiesMock.mockReset()
  setNodeEnv("test")
})

describe("device id cookie", () => {
  it("sets a device cookie when missing", async () => {
    const store = createStore({})
    const setSpy = vi.spyOn(store, "set")
    cookiesMock.mockResolvedValue(store)

    const { getOrSetDeviceId } = await loadDeviceIdModule("test")
    const result = await getOrSetDeviceId()

    expect(result.deviceId).toBeTruthy()
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [name, value, options] = setSpy.mock.calls[0]
    expect(name).toBe("moltook_did")
    expect(value).toBeTruthy()
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })
  })

  it("migrates legacy cookie to __Host- name in production", async () => {
    const store = createStore({ moltook_did: "legacy-device" })
    const setSpy = vi.spyOn(store, "set")
    cookiesMock.mockResolvedValue(store)

    const { getOrSetDeviceId } = await loadDeviceIdModule("production")
    const result = await getOrSetDeviceId()

    expect(result.deviceId).toBe("legacy-device")
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [name, value, options] = setSpy.mock.calls[0]
    expect(name).toBe("__Host-moltook_did")
    expect(value).toBe("legacy-device")
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    })
  })
})
