import { expect, test } from "@playwright/test"

function createUid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

test("signup -> recovery codes -> reset password -> login", async ({ page }) => {
  const uid = createUid()
  const username = `e2e_${uid.slice(0, 8)}`
  const email = `e2e_${uid}@example.com`
  const password = "Goodpass1"
  const nextPassword = "Betterpass1"

  await page.goto("/signup")
  await page.getByLabel("아이디").fill(username)
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호", { exact: true }).fill(password)
  await page.getByLabel("비밀번호 확인").fill(password)
  await page.getByLabel("약관에 동의합니다.").check({ force: true })
  const captchaInput = page.getByLabel("보안 문자")
  await expect(captchaInput).toBeVisible()
  await captchaInput.fill("63067")
  await page.getByTestId("signup-submit").click()

  const codes = page.getByTestId("recovery-code")
  await expect(codes.first()).toBeVisible()
  const firstCode = (await codes.first().textContent())?.trim()
  expect(firstCode).toBeTruthy()

  await page.getByTestId("recovery-saved").check()
  await page.getByTestId("recovery-continue").click()
  await expect(page).toHaveURL(/\/login/)

  await page.goto("/reset-password")
  await page.getByLabel("아이디").fill(username)
  await page.getByLabel("복구코드").fill(firstCode as string)
  await page.getByLabel("새 비밀번호", { exact: true }).fill(nextPassword)
  await page.getByLabel("새 비밀번호 확인").fill(nextPassword)
  await page.getByRole("button", { name: "비밀번호 변경" }).click()
  await expect(page).toHaveURL(/\/login\?reset=1/)

  await page.getByLabel("아이디").fill(username)
  await page.getByLabel("비밀번호", { exact: true }).fill(nextPassword)
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page).toHaveURL(/\/onboarding/)

  const onboardingTitle = page.getByTestId("onboarding-title")
  await expect(onboardingTitle).toHaveText("가입 완료")
  const submitButton = page.getByTestId("submit-button")
  await expect(submitButton).toBeDisabled()
  await page.getByTestId("nickname-input").fill(`온보${uid.slice(0, 6)}`)
  await page.getByTestId("age-checkbox").check()
  await page.getByTestId("terms-checkbox").check()
  await page.getByTestId("privacy-checkbox").check()
  await expect(submitButton).toBeEnabled()

  await page.route("**/api/onboarding/complete", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    await route.continue()
  })
  await submitButton.click()
  await expect(submitButton).toHaveText("처리 중…")
  await expect(page).toHaveURL(/\//)

  await page.goto("/reset-password")
  await page.getByLabel("아이디").fill(username)
  await page.getByLabel("복구코드").fill(firstCode as string)
  await page.getByLabel("새 비밀번호", { exact: true }).fill("Thirdpass1")
  await page.getByLabel("새 비밀번호 확인").fill("Thirdpass1")
  await page.getByRole("button", { name: "비밀번호 변경" }).click()
  await expect(page.getByText("정보를 확인해주세요.")).toBeVisible()
})
