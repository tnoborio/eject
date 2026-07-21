/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
  },
  mutate: [
    "src/modules/eject/application/idempotency.ts",
    "src/modules/eject/domain/authorization.ts",
    "src/modules/eject/domain/exposure.ts",
    "src/modules/eject/domain/lifecycle.ts",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 90,
    low: 80,
    break: null,
  },
  concurrency: 2,
  timeoutMS: 10_000,
};

export default config;
