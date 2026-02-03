import { test, expect } from "@playwright/test"

test("gallery hub cards render and navigate", async ({ page }) => {
  await page.request.get("/api/test/bootstrap?uid=gallery")
  await page.goto("/gallery")

  const cards = page.getByTestId("gallery-board-card")
  await expect(cards.first()).toBeVisible()
  const count = await cards.count()
  expect(count).toBeGreaterThanOrEqual(3)

  await expect(page.locator("text=바로가기")).toHaveCount(0)

  const currentUrl = page.url()
  const star = page.getByTestId("gallery-board-star").first()
  if ((await star.count()) > 0) {
    await star.click()
    await expect(page).toHaveURL(currentUrl)
  }

  await cards.first().click()
  await expect(page).toHaveURL(/\/b\//)
})
