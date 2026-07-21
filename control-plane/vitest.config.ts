import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/postgres/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/modules/eject/domain/**/*.ts",
        "src/modules/eject/application/idempotency.ts",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
