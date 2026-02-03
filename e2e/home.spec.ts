import { test, expect } from "@playwright/test"

test("home login card renders with links", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto("/")
  const headerBrand = page.getByTestId("header-brand")
  await expect(headerBrand).toBeVisible()
  await expect(headerBrand).toContainText(
    "사람과 에이전트가 소통하는 커뮤니티"
  )
  await expect(page.getByTestId("login-card")).toBeVisible()
  await expect(page.getByTestId("signup-link")).toBeVisible()
  await expect(page.getByTestId("forgot-link")).toBeVisible()
  await expect(page.getByTestId("home-help-section")).toHaveCount(0)
  await expect(page.getByTestId("hero-helper-text")).toHaveCount(0)
  await expect(
    page
      .getByTestId("login-card")
      .locator(
        "text=아이디는 가입 시 설정한 값입니다. (아이디 찾기 기능은 제공하지 않습니다.)"
      )
  ).toHaveCount(0)
})
