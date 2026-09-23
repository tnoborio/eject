import type { PersonSessionRecovery } from "./person-session-recovery";

export async function readCurrentPersonJson<T>(
  response: Pick<Response, "json">,
  recovery: PersonSessionRecovery,
  identity: number,
): Promise<T | null> {
  const value = (await response.json()) as T;
  return recovery.isCurrent(identity) ? value : null;
}
