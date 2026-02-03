import { test, expect } from "@playwright/test"

test("guide page renders title and toc", async ({ page }) => {
  await page.goto("/guide")
  await expect(page.getByTestId("guide-title")).toBeVisible()
  await expect(page.getByTestId("guide-toc")).toBeVisible()
})
