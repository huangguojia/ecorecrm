import { defineConfig, devices } from "@playwright/test";

// 端口允许用环境变量覆盖：本地代理/其他工具占用 4288/5288 时，
// 用 E2E_API_PORT / E2E_WEB_PORT 换一组端口即可，不必改配置。
const apiPort = Number(process.env.E2E_API_PORT || 4288);
const webPort = Number(process.env.E2E_WEB_PORT || 5288);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" }
    }
  ],
  webServer: [
    {
      command: `NODE_ENV=e2e CRM_STORE=memory PORT=${apiPort} npm run dev --workspace backend`,
      cwd: "..",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: process.env.E2E_REUSE === "1",
      timeout: 60_000
    },
    {
      command: `VITE_API_TARGET=http://127.0.0.1:${apiPort} npm run dev --workspace frontend -- --port ${webPort}`,
      cwd: "..",
      url: `http://127.0.0.1:${webPort}/`,
      reuseExistingServer: process.env.E2E_REUSE === "1",
      timeout: 60_000
    }
  ]
});
