import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:1431",
    viewport: { width: 1400, height: 900 },
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "python3 scripts/make_fixtures.py tests/fixtures && cargo run --release -q -p fixer-devserver",
    url: "http://127.0.0.1:1431/index.html",
    reuseExistingServer: false,
    timeout: 600_000,
    env: { FFL_DIST: "dist", FFL_PORT: "1431", FFL_CACHE: "/tmp/ffl-test-cache", HOME: "/tmp/ffl-test-home" },
  },
});
