import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: mocks.useRouter,
  usePathname: mocks.usePathname,
}))

import Logo from "../src/components/brand/Logo"

describe("헤더 로고 클릭", () => {
  beforeEach(() => {
    mocks.useRouter.mockReset()
    mocks.usePathname.mockReset()
  })

  it("홈에서는 refresh를 호출한다", () => {
    const refresh = vi.fn()
    mocks.useRouter.mockReturnValue({ refresh })
    mocks.usePathname.mockReturnValue("/")

    const element = Logo()
    const onClick = element.props.onClick as (event: { preventDefault: () => void }) => void
    const preventDefault = vi.fn()
    onClick({ preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("홈이 아니면 refresh를 호출하지 않는다", () => {
    const refresh = vi.fn()
    mocks.useRouter.mockReturnValue({ refresh })
    mocks.usePathname.mockReturnValue("/b/test")

    const element = Logo()
    const onClick = element.props.onClick as (event: { preventDefault: () => void }) => void
    const preventDefault = vi.fn()
    onClick({ preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
