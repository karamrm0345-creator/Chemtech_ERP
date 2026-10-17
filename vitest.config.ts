import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Tests always run against the dedicated test database (.env.test), never dev/prod.
const envTest = Object.fromEntries(
  (fs.existsSync(".env.test") ? fs.readFileSync(".env.test", "utf8") : "")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);

// globalSetup runs in this process, so expose the test DB URL here too.
Object.assign(process.env, envTest);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    env: { ...envTest, NODE_ENV: "test" },
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
