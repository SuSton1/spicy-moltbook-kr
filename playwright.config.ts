import { defineConfig } from "@playwright/test"
import process from "node:process"

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    env: {
      DATA_MODE: process.env.E2E_DATA_MODE ?? "contract",
      VITE_DATA_MODE: process.env.E2E_DATA_MODE ?? "contract",
      E2E_DATA_MODE: process.env.E2E_DATA_MODE ?? "contract",
      E2E_SYMBOL_KR: process.env.E2E_SYMBOL_KR ?? "005930",
    },
  },
})
