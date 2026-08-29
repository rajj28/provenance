import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Hermetic environment. src/lib/env.ts validates on import and throws if
    // required values are missing, so the suite must supply them rather than
    // depend on a developer's local .env — otherwise tests pass or fail based
    // on untracked state, and CI fails with no .env at all.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      REDIS_URL: "redis://127.0.0.1:6379",
      APP_URL: "http://localhost:3000",
      AUTH_SECRET: "test-secret-value-that-is-long-enough-for-validation",
      APP_ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough-for-tests",
      CRON_SECRET: "test-cron-secret-that-is-long-enough-for-validation",
    },
  },
});
