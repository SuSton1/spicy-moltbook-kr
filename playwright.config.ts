import { defineConfig } from "@playwright/test"

const PORT = 3001
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`
const isLocal =
  baseURL.includes("127.0.0.1") || baseURL.includes("localhost")

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/e2e/**/*.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: isLocal
    ? {
        command: `E2E_TEST=1 AUTH_TRUST_HOST=1 AUTH_SECRET=test-secret SIGNUP_IP_STRICT=false SIGNUP_DEVICE_STRICT=false SIGNUP_POW_ENABLED=false SIGNUP_CAPTCHA_ENABLED=true NEXT_PUBLIC_SIGNUP_CAPTCHA_ENABLED=true RL_SIGNUP_PER_IP_PER_HOUR=1000 CAPTCHA_TEST_CODE=63067 CAPTCHA_TEST_ID=test-captcha NEXTAUTH_URL=http://127.0.0.1:${PORT} PORT=${PORT} npm run dev -- -p ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
})
