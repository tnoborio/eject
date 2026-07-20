export const MAX_COMMAND_TTL_MS: number;
export const MAX_FUTURE_ISSUE_SKEW_MS: number;

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly unknown[];
}

export function validateMessage(message: unknown): ValidationResult;

export function inspectCommand(
  command: unknown,
  options: {
    readonly expectedDeviceId: string;
    readonly now: Date;
    readonly seenCommandIds: Set<string>;
    readonly paused?: boolean;
    readonly hasApprovedDrive?: boolean;
  },
):
  | { readonly accepted: true; readonly result: "ACCEPTED" }
  | { readonly accepted: false; readonly result: string };

export function isAllowedLifecycleTransition(from: string, to: string): boolean;
export function validateLifecycleSequence(events: readonly unknown[]): boolean;
