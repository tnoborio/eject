import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/postgres/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/modules/eject/domain/**/*.ts",
        "src/modules/eject/application/idempotency.ts",
        "src/modules/identity/application/authenticate-person-session.ts",
        "src/modules/identity/application/manage-person-session.ts",
        "src/modules/identity/infrastructure/supabase-person-token-verifier.ts",
        "src/modules/identity/transport/person-session-cookie.ts",
        "src/modules/devices/application/device-enrollment.ts",
        "src/modules/permissions/application/manage-recipient-consent.ts",
        "src/modules/permissions/application/manage-relationships.ts",
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
