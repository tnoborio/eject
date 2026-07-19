import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const MAX_COMMAND_TTL_MS = 60_000;
export const MAX_FUTURE_ISSUE_SKEW_MS = 30_000;

const schemaPath = fileURLToPath(
  new URL("./eject-protocol.schema.json", import.meta.url),
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const timestampPattern =
  /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/;

const transitions = new Map([
  ["REQUESTED", new Set(["REJECTED", "AUTHORIZED"])],
  ["AUTHORIZED", new Set(["QUEUED", "CANCELLED"])],
  ["QUEUED", new Set(["DISPATCHED", "EXPIRED", "CANCELLED"])],
  ["DISPATCHED", new Set(["DISPATCHED", "DELIVERED", "EXPIRED", "CANCELLED"])],
  ["DELIVERED", new Set(["REJECTED_BY_AGENT", "ATTEMPTED"])],
  ["ATTEMPTED", new Set(["FAILED", "OUTCOME_UNKNOWN"])],
]);

export function validateMessage(message) {
  const valid = validate(message);
  return {
    valid,
    errors: valid ? [] : structuredClone(validate.errors ?? []),
  };
}

export function inspectCommand(
  command,
  {
    expectedDeviceId,
    now,
    seenCommandIds,
    paused = false,
    hasApprovedDrive = true,
  },
) {
  if (!validateMessage(command).valid || command.kind !== "COMMAND") {
    return rejection("INVALID_COMMAND");
  }

  if (command.device_id !== expectedDeviceId) {
    return rejection("AUDIENCE_MISMATCH");
  }

  const issuedAt = parseTimestamp(command.issued_at);
  const expiresAt = parseTimestamp(command.expires_at);
  const nowValue = now.getTime();
  const ttl = expiresAt - issuedAt;

  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    return rejection("INVALID_COMMAND");
  }

  if (ttl <= 0 || ttl > MAX_COMMAND_TTL_MS) {
    return rejection("INVALID_COMMAND");
  }

  if (nowValue >= expiresAt) {
    return rejection("COMMAND_EXPIRED");
  }

  if (issuedAt - nowValue > MAX_FUTURE_ISSUE_SKEW_MS) {
    return rejection("COMMAND_ISSUED_IN_FUTURE");
  }

  if (seenCommandIds.has(command.command_id)) {
    return rejection("COMMAND_REPLAYED");
  }

  // Production callers must persist this consumption before attempting the
  // physical operation. Result-delivery retries reuse the stored result and
  // never call the adapter again.
  seenCommandIds.add(command.command_id);

  if (paused) {
    return rejection("AGENT_PAUSED");
  }

  if (!hasApprovedDrive) {
    return rejection("NO_APPROVED_DRIVE");
  }

  return { accepted: true, result: "ACCEPTED" };
}

export function isAllowedLifecycleTransition(from, to) {
  return transitions.get(from)?.has(to) ?? false;
}

export function validateLifecycleSequence(events) {
  if (!Array.isArray(events) || events.length === 0 || events[0].state !== "REQUESTED") {
    return false;
  }

  const commandId = events[0].command_id;
  const eventIds = new Set();
  let previousTime = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const occurredAt = parseTimestamp(event.occurred_at);
    if (
      !validateMessage(event).valid ||
      event.kind !== "LIFECYCLE_EVENT" ||
      event.command_id !== commandId ||
      eventIds.has(event.event_id) ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousTime
    ) {
      return false;
    }

    if (
      index > 0 &&
      !isAllowedLifecycleTransition(events[index - 1].state, event.state)
    ) {
      return false;
    }

    eventIds.add(event.event_id);
    previousTime = occurredAt;
  }

  return true;
}

function rejection(result) {
  return { accepted: false, result };
}

function parseTimestamp(value) {
  const match = timestampPattern.exec(value);
  if (!match) {
    return Number.NaN;
  }

  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const millisecond = Number(`${fraction}000`.slice(0, 3));
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millisecond,
  );
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    return Number.NaN;
  }

  return timestamp;
}
