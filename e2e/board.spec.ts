import { expect, test } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"

function createUid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function seedBoard(request: APIRequestContext, uid: string) {
  const response = await request.get(`/api/test/bootstrap?seed=1&uid=${uid}`)
  expect(response.ok()).toBeTruthy()
}

async function getBoardSlug(request: APIRequestContext) {
  const response = await request.get("/api/boards")
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as {
    data?: { items?: { slug?: string }[] }
  }
  return payload?.data?.items?.[0]?.slug ?? "singularity"
}

test("board table renders dense list", async ({ page, request }) => {
  const uid = createUid()
  await seedBoard(request, uid)
  const slug = await getBoardSlug(request)

  await page.goto(`/b/${slug}`)

  const table = page.getByTestId("board-table")
  await expect(table).toBeVisible()

  const firstRow = page.getByTestId("board-row").first()
  await expect(firstRow).toBeVisible()
  await expect(firstRow.getByRole("link")).toHaveCount(1)
})
