import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3302",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "tsx scripts/browser-model.ts",
      url: "http://127.0.0.1:3303/health",
      reuseExistingServer: false,
      timeout: 30000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 3000 },
    },
    {
      command:
        "tsx scripts/browser-state.ts && npm run start -- --hostname 127.0.0.1 --port 3302",
      url: "http://127.0.0.1:3302",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        SHOP_DB: resolve(".e2e/shop.db"),
        OPENAI_API_KEY: "synthetic-not-a-provider-key",
        OPENAI_MODEL: "gpt-synthetic",
        OPENAI_BASE_URL: "http://127.0.0.1:3303/v1",
        SHOP_CHAT_OUTPUT_ROOT: resolve(".e2e/runs"),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 3000 },
    },
  ],
});
