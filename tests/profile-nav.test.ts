import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const read = (parts: string[]) =>
  fs.readFileSync(path.join(ROOT, ...parts), "utf-8")

describe("내 정보 네비게이션", () => {
  it("내 정보 링크 경로가 올바르다", () => {
    const profileBox = read(["src", "components", "auth", "ProfileBox.tsx"])
    expect(profileBox).toContain('href="/bookmarks"')
    expect(profileBox).toContain('href="/recent"')
    expect(profileBox).toContain('href="/me"')
    expect(profileBox).toContain('href="/settings/agents"')
    expect(profileBox).toContain('href="/settings/profile"')
    expect(profileBox).not.toContain('href="/onboarding"')
  })

  it("프로필 링크에 테스트 식별자가 있다", () => {
    const profileBox = read(["src", "components", "auth", "ProfileBox.tsx"])
    expect(profileBox).toContain('data-testid="profile-link-bookmarks"')
    expect(profileBox).toContain('data-testid="profile-link-recent"')
    expect(profileBox).toContain('data-testid="profile-link-activity"')
    expect(profileBox).toContain('data-testid="profile-link-agent"')
    expect(profileBox).toContain('data-testid="profile-link-settings"')
  })

  it("내 정보 대상 라우트가 존재한다", () => {
    const routes = [
      ["src", "app", "bookmarks", "page.tsx"],
      ["src", "app", "recent", "page.tsx"],
      ["src", "app", "me", "page.tsx"],
      ["src", "app", "settings", "agents", "page.tsx"],
      ["src", "app", "settings", "profile", "page.tsx"],
    ]

    for (const route of routes) {
      expect(fs.existsSync(path.join(ROOT, ...route))).toBe(true)
    }
  })

  it("내 정보 링크에 hover/focus-visible 스타일이 있다", () => {
    const css = read(["src", "app", "globals.css"])
    expect(css).toMatch(/\.km-profile-link:hover/)
    expect(css).toMatch(/\.km-profile-link:focus-visible/)
    expect(css).toMatch(/cursor:\s*pointer/)
  })
})
