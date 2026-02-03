import { expect, test } from "@playwright/test"
import type { APIRequestContext, Locator, Page } from "@playwright/test"

function createUid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function seed(request: APIRequestContext, uid: string) {
  const response = await request.get(`/api/test/bootstrap?seed=1&uid=${uid}`)
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<{ postId: string; postTitle: string }>
}

async function login(page: Page, uid: string) {
  const response = await page.request.get(`/api/test/bootstrap?login=1&uid=${uid}`)
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as {
    username?: string
    password?: string
  }
  if (!payload.username || !payload.password) {
    throw new Error("Missing test credentials")
  }

  await page.goto("/login")
  await page.getByLabel("아이디").fill(payload.username)
  await page.getByLabel("비밀번호", { exact: true }).fill(payload.password)
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function readCount(locator: Locator) {
  const text = (await locator.textContent()) ?? ""
  const match = text.match(/(\d+)/)
  return match ? Number.parseInt(match[1], 10) : 0
}

test("feed -> post detail renders", async ({ page }) => {
  const uid = createUid()
  await login(page, uid)
  await page.goto("/feed")

  const postLink = page.getByRole("link", { name: /\[E2E\]/ }).first()
  await expect(postLink).toBeVisible()
  await postLink.click()

  await expect(page).toHaveURL(/\/p\//)
  const title = page.getByTestId("post-title")
  await expect(title).toBeVisible()
  const postMeta = page.getByTestId("post-meta")
  await expect(postMeta).toBeVisible()
  const postBody = page.getByTestId("post-content")
  await expect(postBody).toContainText("E2E")
  await expect(page.getByTestId("post-vote-bar")).toBeVisible()
  await expect(page.getByTestId("comments-section")).toBeVisible()
})

test("logged-in comment, reply, and votes work", async ({ page, request }) => {
  const authorUid = createUid()
  const { postId } = await seed(request, authorUid)
  const voterUid = createUid()
  await login(page, voterUid)
  await page.goto(`/p/${postId}`)

  const commentText = `E2E comment ${Date.now()}`
  await page.getByRole("textbox", { name: "댓글" }).fill(commentText)
  await page.getByRole("button", { name: "등록" }).first().click()
  const parentRow = page
    .getByTestId("comment-row")
    .filter({ hasText: commentText })
    .first()
  await expect(parentRow).toBeVisible()
  await expect(
    parentRow.locator('[data-testid="author-mark"][data-author-kind="HUMAN"]')
  ).toBeVisible()
  await expect(
    page.getByTestId("comments-section").getByText("답글")
  ).toHaveCount(0)
  await expect(
    page.getByTestId("comments-section").getByRole("button", {
      name: /^추천/,
    })
  ).toHaveCount(0)
  await expect(
    page.getByTestId("comments-section").getByRole("button", {
      name: /^비추천/,
    })
  ).toHaveCount(0)

  const parentBody = parentRow.getByTestId("comment-body")
  const allRows = page.getByTestId("comment-row")
  const rowCount = await allRows.count()
  const secondRow = rowCount > 1 ? allRows.nth(1) : null

  await parentBody.click()
  const replyComposer = parentRow.getByTestId("reply-composer")
  await expect(replyComposer).toBeVisible()

  if (secondRow) {
    const secondBody = secondRow.getByTestId("comment-body")
    await secondBody.click()
    const secondReplyComposer = secondRow.getByTestId("reply-composer")
    await expect(secondReplyComposer).toBeVisible()
    await expect(replyComposer).toHaveCount(0)
    await secondBody.click()
    await expect(secondReplyComposer).toHaveCount(0)
    await secondBody.dblclick()
    await page.waitForTimeout(250)
    await expect(secondReplyComposer).toHaveCount(0)
  } else {
    await parentBody.click()
    await expect(replyComposer).toHaveCount(0)
    await parentBody.dblclick()
    await page.waitForTimeout(250)
    await expect(replyComposer).toHaveCount(0)
  }

  await parentBody.click()
  await expect(replyComposer).toBeVisible()
  const replyText = `E2E reply ${Date.now()}`
  await replyComposer.getByRole("textbox").fill(replyText)
  await replyComposer.getByRole("button", { name: "등록" }).click()
  await expect(
    page.getByTestId("comment-row").filter({ hasText: replyText }).first()
  ).toBeVisible()

  const postVote = page.getByTestId("post-vote-bar")
  const postUp = postVote.getByRole("button", { name: /^추천/ }).first()
  const postUp0 = await readCount(postUp)

  const [voteUpResponse] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/votes/post") &&
        resp.request().method() === "POST"
    ),
    postUp.click(),
  ])
  const voteUpPayload = await voteUpResponse.json().catch(() => null)
  expect(voteUpResponse.ok(), JSON.stringify(voteUpPayload)).toBeTruthy()
  await expect.poll(() => readCount(postUp)).toBe(postUp0 + 1)
  // Toggle back/downvote flows are covered elsewhere; here we only assert an upvote succeeds.

  const authorLink = parentRow.getByTestId("author-search-link")
  await authorLink.click()
  await expect(page).toHaveURL(/authorId=/)
})

test("agent comment shows A mark and robot icon", async ({ page, request }) => {
  const uid = createUid()
  const response = await request.get(
    `/api/test/bootstrap?seed=1&uid=${uid}-agent&agent=1`
  )
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { postId: string }
  const postId = payload.postId
  await page.goto(`/p/${postId}`)

  const agentRow = page
    .getByTestId("comment-row")
    .filter({ hasText: "에이전트 댓글" })
    .first()
  await expect(agentRow).toBeVisible()
  await expect(
    agentRow.locator('[data-testid="author-mark"][data-author-kind="AGENT"]')
  ).toBeVisible()
  await expect(agentRow.locator(".agent-icon")).toBeVisible()
})

test("agent start requires agent nickname", async ({ page }) => {
  const uid = createUid()
  await login(page, uid)
  await page.goto("/settings/agents")

  const nicknameInput = page.getByTestId("agent-nickname-input")
  await expect(nicknameInput).toBeVisible()
  await expect(page.getByTestId("agent-connect-cta")).toBeDisabled()

  const nextName = `에이${uid.slice(0, 4)}`
  await nicknameInput.fill(nextName)
  await page.getByTestId("agent-nickname-save").click()
  await expect(page.getByTestId("agent-connect-cta")).toBeEnabled()
})

test("logged-out vote blocked and API returns 401", async ({ page, request }) => {
  const uid = createUid()
  const { postId } = await seed(request, uid)
  await page.addInitScript(() => {
    const w = window as Window & { __lastAlert?: string }
    w.__lastAlert = ""
    window.alert = (message) => {
      w.__lastAlert = String(message)
    }
  })
  await page.goto(`/p/${postId}`)

  await page
    .getByTestId("post-vote-bar")
    .getByRole("button", { name: /^추천/ })
    .first()
    .click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as Window & { __lastAlert?: string }
        return w.__lastAlert ?? ""
      })
    )
    .toContain("로그인 후 이용")

  const response = await request.post("/api/votes/post", {
    data: { id: postId, value: 1 },
  })
  expect(response.status()).toBe(401)
})
