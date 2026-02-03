import { test, expect } from "@playwright/test"

test("signup sends captcha when input is filled", async ({ page }) => {
  await page.goto("/signup")

  const suffix = String(Date.now()).slice(-6)
  await page.fill("#username", `cap_${suffix}`)
  await page.fill("#email", `cap_${suffix}@example.com`)
  await page.fill("#password", "TestPassword123!")
  await page.fill("#passwordConfirm", "TestPassword123!")
  await page.check("input[type=checkbox]")

  const captchaInput = page.getByLabel("보안 문자")
  await captchaInput.fill("63067")

  const registerRequestPromise = page.waitForRequest((request) => {
    return (
      request.url().includes("/api/auth/register") && request.method() === "POST"
    )
  })
  const registerResponsePromise = page.waitForResponse((response) => {
    return response.url().includes("/api/auth/register")
  })

  await page.getByTestId("signup-submit").click()

  const registerRequest = await registerRequestPromise
  await registerResponsePromise
  const postData = registerRequest.postData() ?? "{}"
  let captchaValue = ""
  try {
    const payload = JSON.parse(postData)
    captchaValue =
      payload.captcha ?? payload.captchaText ?? payload.captcha_code ?? ""
  } catch {
    captchaValue = ""
  }

  expect(String(captchaValue).length).toBeGreaterThan(0)

  const requiredError = page.getByText("보안 문자를 입력해줘.")
  await expect(requiredError).toHaveCount(0)
})

test("signup shows loading state and hint while submitting", async ({ page }) => {
  await page.route("**/api/auth/register", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "CAPTCHA_REQUIRED", message: "보안 문자를 입력해줘." },
      }),
    })
  })

  await page.goto("/signup")

  const suffix = String(Date.now()).slice(-6)
  await page.fill("#username", `load_${suffix}`)
  await page.fill("#email", `load_${suffix}@example.com`)
  await page.fill("#password", "TestPassword123!")
  await page.fill("#passwordConfirm", "TestPassword123!")
  await page.check("input[type=checkbox]")

  const captchaInput = page.getByLabel("보안 문자")
  await captchaInput.fill("63067")

  const submitButton = page.getByTestId("signup-submit")
  await submitButton.click()
  await expect(submitButton).toBeDisabled()
  await expect(submitButton).toContainText("가입 처리 중…")
  const loadingHint = page.getByTestId("signup-loading-hint")
  await expect(loadingHint).toHaveText("처리 중…")

  await page.waitForResponse("**/api/auth/register")
  await expect(submitButton).toBeEnabled()
})
