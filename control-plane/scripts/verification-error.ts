import { PoolConfigurationError } from "../src/infrastructure/postgres/pool-config";

// Use only for bounded verification messages, never for upstream error text.
export class VerificationError extends Error {}

export function reportVerificationFailure(error: unknown): void {
  console.error(
    error instanceof VerificationError ||
      error instanceof PoolConfigurationError
      ? error.message
      : "Cloud database verification failed",
  );
  process.exitCode = 1;
}
