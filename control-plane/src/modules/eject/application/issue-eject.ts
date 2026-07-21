import {
  authorizeEject,
  type AuthorizationFacts,
  type RejectionReason,
} from "../domain/authorization";
import { semanticRequestFingerprint } from "./idempotency";

export interface IssueEjectInput {
  readonly actorId: string;
  readonly recipientId: string;
  readonly idempotencyKey: string;
  readonly action: "EJECT" | "EJECT_BACK";
  readonly replyToCommandId: string | null;
  readonly now: Date;
}

export type IssueEjectResult =
  | {
      readonly outcome: "QUEUED";
      readonly requestId: string;
      readonly commandId: string;
    }
  | {
      readonly outcome: "REJECTED";
      readonly requestId: string;
      readonly reason: RejectionReason;
    }
  | { readonly outcome: "IDEMPOTENCY_CONFLICT" };

export interface StoredIdempotentResult {
  readonly fingerprint: string;
  readonly result: Exclude<
    IssueEjectResult,
    { readonly outcome: "IDEMPOTENCY_CONFLICT" }
  >;
}

export interface IssuanceTransaction {
  findIdempotentResult(
    actorId: string,
    idempotencyKey: string,
  ): Promise<StoredIdempotentResult | null>;
  loadAuthorizationFacts(input: IssueEjectInput): Promise<AuthorizationFacts>;
  recordRejection(input: {
    readonly requestId: string;
    readonly requestedEventId: string;
    readonly rejectedEventId: string;
    readonly issue: IssueEjectInput;
    readonly fingerprint: string;
    readonly reason: RejectionReason;
  }): Promise<IssueEjectResult & { readonly outcome: "REJECTED" }>;
  recordQueued(input: {
    readonly requestId: string;
    readonly commandId: string;
    readonly requestedEventId: string;
    readonly authorizedEventId: string;
    readonly queuedEventId: string;
    readonly issue: IssueEjectInput;
    readonly fingerprint: string;
    readonly effectiveExposureLimit: number;
  }): Promise<IssueEjectResult & { readonly outcome: "QUEUED" }>;
}

export interface IssuanceStore {
  withSerializableRecipientLock<T>(
    recipientId: string,
    operation: (transaction: IssuanceTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface IdGenerator {
  newId(): string;
}

export function createIssueEject(dependencies: {
  readonly store: IssuanceStore;
  readonly ids: IdGenerator;
}) {
  return async function issueEject(
    input: IssueEjectInput,
  ): Promise<IssueEjectResult> {
    const fingerprint = semanticRequestFingerprint(input);

    return dependencies.store.withSerializableRecipientLock(
      input.recipientId,
      async (transaction) => {
        const existing = await transaction.findIdempotentResult(
          input.actorId,
          input.idempotencyKey,
        );
        if (existing !== null) {
          return existing.fingerprint === fingerprint
            ? existing.result
            : { outcome: "IDEMPOTENCY_CONFLICT" };
        }

        const facts = await transaction.loadAuthorizationFacts(input);
        const decision = authorizeEject(facts, input.now);
        const requestId = dependencies.ids.newId();

        if (!decision.authorized) {
          return transaction.recordRejection({
            requestId,
            requestedEventId: dependencies.ids.newId(),
            rejectedEventId: dependencies.ids.newId(),
            issue: input,
            fingerprint,
            reason: decision.reason,
          });
        }

        return transaction.recordQueued({
          requestId,
          commandId: dependencies.ids.newId(),
          requestedEventId: dependencies.ids.newId(),
          authorizedEventId: dependencies.ids.newId(),
          queuedEventId: dependencies.ids.newId(),
          issue: input,
          fingerprint,
          effectiveExposureLimit: decision.effectiveExposureLimit,
        });
      },
    );
  };
}
