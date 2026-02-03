import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import fs from "fs"
import path from "path"

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001"
const ARTIFACTS_DIR = path.resolve(process.cwd(), "artifacts/ops")
const IS_LOCAL = BASE_URL.includes("127.0.0.1") || BASE_URL.includes("localhost")

type LinkTarget = {
  href: string
  label: string
}

function toAbsolute(href: string) {
  try {
    return new URL(href, BASE_URL).toString()
  } catch {
    return href
  }
}

function uniq(items: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

async function collectPostLinks(page: Page, limit: number) {
  const hrefs = await page
    .locator('main a[href*="/p/"]')
    .evaluateAll((links: HTMLAnchorElement[]) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
    )
  const normalized = uniq(
    hrefs
      .filter((href) => href.includes("/p/"))
      .map((href) => toAbsolute(href))
  )
  return normalized.slice(0, limit)
}

async function collectBoardLinks(page: Page, limit: number) {
  const hrefs = await page
    .locator('nav[aria-label="주요 메뉴"] a[href^="/b/"]')
    .evaluateAll((links: HTMLAnchorElement[]) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
    )
  return uniq(hrefs).slice(0, limit).map((href) => toAbsolute(href))
}

async function recordFailure(
  page: Page,
  label: string,
  href: string
) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48)
  const base = path.join(ARTIFACTS_DIR, `live_click_fail_${safeLabel}_${stamp}`)
  await page.screenshot({ path: `${base}.png`, fullPage: true })
  const html = await page.content()
  fs.writeFileSync(`${base}.html`, html.slice(0, 50000))
  fs.writeFileSync(
    `${base}.txt`,
    `label: ${label}\nhref: ${href}\nurl: ${page.url()}\n`
  )
}

async function assertPostPage(
  page: Page
) {
  const notFound = page.getByText("This page could not be found.")
  await expect(notFound).toHaveCount(0)
  const title = page.getByTestId("post-title").first()
  await expect(title).toBeVisible()
  await expect(page.getByTestId("post-meta")).toBeVisible()
  const body = page.getByTestId("post-content").first()
  await expect(body).toBeVisible()
  await expect(page.getByTestId("post-vote-bar")).toBeVisible()
}

async function openAndCheck(page: Page, target: LinkTarget) {
  const url = new URL(target.href, BASE_URL)
  const relative = `${url.pathname}${url.search}`
  const locator = page.locator(`main a[href="${relative}"]`).first()
  if ((await locator.count()) > 0) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      locator.click(),
    ])
  } else {
    await page.goto(target.href, { waitUntil: "domcontentloaded" })
  }

  try {
    await assertPostPage(page)
  } catch (error) {
    await recordFailure(page, target.label, target.href)
    throw error
  }
}

test("live post links are not 404", async ({ page }) => {
  const feedTargets: LinkTarget[] = []
  if (IS_LOCAL && process.env.E2E_TEST === "1") {
    await page.goto("/api/test/bootstrap?uid=live-post-links", {
      waitUntil: "domcontentloaded",
    })
  }
  await page.goto("/feed", { waitUntil: "domcontentloaded" })

  const feedLinks = await collectPostLinks(page, 25)
  if (feedLinks.length === 0) {
    await recordFailure(page, "feed_empty", "/feed")
    throw new Error("No post links found on /feed")
  }
  feedLinks.forEach((href, index) =>
    feedTargets.push({ href, label: `feed_${index + 1}` })
  )

  for (const target of feedTargets) {
    await openAndCheck(page, target)
    await page.goBack({ waitUntil: "domcontentloaded" })
  }

  const boardLinks = await collectBoardLinks(page, 2)
  for (const boardHref of boardLinks) {
    await page.goto(boardHref, { waitUntil: "domcontentloaded" })
    const boardPosts = await collectPostLinks(page, 25)
    if (boardPosts.length === 0) {
      if (!IS_LOCAL) {
        await recordFailure(page, "board_empty", boardHref)
        throw new Error(`No post links found on ${boardHref}`)
      }
      continue
    }
    for (const [index, href] of boardPosts.entries()) {
      await openAndCheck(page, { href, label: `board_${index + 1}` })
      await page.goBack({ waitUntil: "domcontentloaded" })
    }
  }

  await page.goto("/search?q=test", { waitUntil: "domcontentloaded" })
  const searchPosts = await collectPostLinks(page, 15)
  for (const [index, href] of searchPosts.entries()) {
    await openAndCheck(page, { href, label: `search_${index + 1}` })
    await page.goBack({ waitUntil: "domcontentloaded" })
  }
})
