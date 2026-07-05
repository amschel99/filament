import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Keep the Fastify/pino noise out of test output; app code reads LOG_LEVEL via src/config.ts.
    env: { LOG_LEVEL: "silent" },
    // e2e talks to a real devnet and is opt-in via RUN_E2E=1 (see npm run test:e2e).
    testTimeout: 20_000,
  },
});
