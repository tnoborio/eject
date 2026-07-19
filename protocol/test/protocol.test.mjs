import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectCommand,
  isAllowedLifecycleTransition,
  validateLifecycleSequence,
  validateMessage,
} from "../v1/reference-validator.mjs";

const fixturesRoot = new URL("../v1/fixtures/", import.meta.url);
const expectedDeviceId = "018f47a0-7b2c-7c9d-8e1f-1123456789ab";
const now = new Date("2026-07-18T05:00:10Z");

function fixture(group, name) {
  const path = fileURLToPath(new URL(`${group}/${name}`, fixturesRoot));
  return JSON.parse(readFileSync(path, "utf8"));
}

test("all valid fixtures satisfy the closed schema", () => {
  const directory = fileURLToPath(new URL("valid/", fixturesRoot));
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const result = validateMessage(fixture("valid", name));
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test("all structurally invalid fixtures are rejected", () => {
  const directory = fileURLToPath(new URL("invalid/", fixturesRoot));
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    assert.equal(validateMessage(fixture("invalid", name)).valid, false, name);
  }
});

test("device paths and localized sentences fail as unknown command fields", () => {
  for (const [name, field] of [
    ["command-with-device-path.json", "drive_path"],
    ["command-with-localized-message.json", "localized_message"],
  ]) {
    const result = validateMessage(fixture("invalid", name));
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(
        (error) =>
          error.keyword === "additionalProperties" &&
          error.params.additionalProperty === field,
      ),
      true,
      name,
    );
  }
});

test("version and notification variables stay bounded", () => {
  const command = fixture("valid", "command.json");
  const futureVersion = structuredClone(command);
  futureVersion.protocol_version = 2;
  assert.equal(validateMessage(futureVersion).valid, false);

  const controlCharacter = structuredClone(command);
  controlCharacter.actor.display_name = "Kaz\nRUN";
  assert.equal(validateMessage(controlCharacter).valid, false);
});

test("a command is accepted once for its exact device audience", () => {
  const seenCommandIds = new Set();
  const command = fixture("valid", "command.json");

  assert.deepEqual(
    inspectCommand(command, { expectedDeviceId, now, seenCommandIds }),
    { accepted: true, result: "ACCEPTED" },
  );
  assert.deepEqual(
    inspectCommand(command, { expectedDeviceId, now, seenCommandIds }),
    { accepted: false, result: "COMMAND_REPLAYED" },
  );
});

test("an audience mismatch is rejected without consuming the command id", () => {
  const seenCommandIds = new Set();
  const command = fixture("valid", "command.json");

  assert.deepEqual(
    inspectCommand(command, {
      expectedDeviceId: "018f47a0-7b2c-7c9d-8e1f-5123456789ab",
      now,
      seenCommandIds,
    }),
    { accepted: false, result: "AUDIENCE_MISMATCH" },
  );
  assert.equal(seenCommandIds.size, 0);
});

test("expired, future-issued, and overlong commands are rejected", () => {
  const command = fixture("valid", "command.json");
  assert.equal(
    inspectCommand(command, {
      expectedDeviceId,
      now: new Date("2026-07-18T05:00:30Z"),
      seenCommandIds: new Set(),
    }).result,
    "COMMAND_EXPIRED",
  );

  const futureCommand = structuredClone(command);
  futureCommand.command_id = "018f47a0-7b2c-7c9d-8e1f-6123456789ab";
  futureCommand.issued_at = "2026-07-18T05:01:00Z";
  futureCommand.expires_at = "2026-07-18T05:01:30Z";
  assert.equal(
    inspectCommand(futureCommand, {
      expectedDeviceId,
      now,
      seenCommandIds: new Set(),
    }).result,
    "COMMAND_ISSUED_IN_FUTURE",
  );

  const overlong = fixture("semantic-invalid", "command-ttl-too-long.json");
  assert.equal(validateMessage(overlong).valid, true);
  assert.equal(
    inspectCommand(overlong, {
      expectedDeviceId,
      now,
      seenCommandIds: new Set(),
    }).result,
    "INVALID_COMMAND",
  );

  const impossibleDate = structuredClone(command);
  impossibleDate.command_id = "018f47a0-7b2c-7c9d-8e1f-8123456789ab";
  impossibleDate.issued_at = "2026-02-31T05:00:00Z";
  impossibleDate.expires_at = "2026-02-31T05:00:30Z";
  assert.equal(validateMessage(impossibleDate).valid, true);
  assert.equal(
    inspectCommand(impossibleDate, {
      expectedDeviceId,
      now,
      seenCommandIds: new Set(),
    }).result,
    "INVALID_COMMAND",
  );
});

test("local pause and missing approval consume the command without an attempt", () => {
  const pausedIds = new Set();
  const pausedCommand = fixture("valid", "command.json");
  assert.equal(
    inspectCommand(pausedCommand, {
      expectedDeviceId,
      now,
      seenCommandIds: pausedIds,
      paused: true,
    }).result,
    "AGENT_PAUSED",
  );
  assert.equal(pausedIds.has(pausedCommand.command_id), true);

  const noDriveCommand = structuredClone(pausedCommand);
  noDriveCommand.command_id = "018f47a0-7b2c-7c9d-8e1f-7123456789ab";
  const noDriveIds = new Set();
  assert.equal(
    inspectCommand(noDriveCommand, {
      expectedDeviceId,
      now,
      seenCommandIds: noDriveIds,
      hasApprovedDrive: false,
    }).result,
    "NO_APPROVED_DRIVE",
  );
  assert.equal(noDriveIds.has(noDriveCommand.command_id), true);
});

test("lifecycle transitions remain factual and terminal", () => {
  const validSequence = [
    "REQUESTED",
    "AUTHORIZED",
    "QUEUED",
    "DISPATCHED",
    "DELIVERED",
    "ATTEMPTED",
    "OUTCOME_UNKNOWN",
  ];

  for (let index = 1; index < validSequence.length; index += 1) {
    assert.equal(
      isAllowedLifecycleTransition(validSequence[index - 1], validSequence[index]),
      true,
    );
  }

  assert.equal(isAllowedLifecycleTransition("DISPATCHED", "OUTCOME_UNKNOWN"), false);
  assert.equal(isAllowedLifecycleTransition("OUTCOME_UNKNOWN", "ATTEMPTED"), false);
});

test("lifecycle reasons must match their factual state", () => {
  const event = fixture("valid", "lifecycle-outcome-unknown.json");

  const requested = structuredClone(event);
  requested.state = "REQUESTED";
  requested.reason_code = null;
  assert.equal(validateMessage(requested).valid, true);

  const failed = structuredClone(event);
  failed.state = "FAILED";
  failed.reason_code = "DRIVE_BUSY";
  assert.equal(validateMessage(failed).valid, true);

  failed.reason_code = "PHYSICAL_OUTCOME_UNVERIFIED";
  assert.equal(validateMessage(failed).valid, false);
});

test("a lifecycle sequence is ordered, unique, and bound to one command", () => {
  const base = fixture("valid", "lifecycle-outcome-unknown.json");
  const states = [
    "REQUESTED",
    "AUTHORIZED",
    "QUEUED",
    "DISPATCHED",
    "DELIVERED",
    "ATTEMPTED",
    "OUTCOME_UNKNOWN",
  ];
  const events = states.map((state, index) => ({
    ...base,
    event_id: `018f47a0-7b2c-7c9d-8e1f-${index + 3}123456789ab`,
    state,
    reason_code: state === "OUTCOME_UNKNOWN" ? "PHYSICAL_OUTCOME_UNVERIFIED" : null,
    occurred_at: `2026-07-18T05:00:0${index}Z`,
  }));

  assert.equal(validateLifecycleSequence(events), true);

  const backwards = structuredClone(events);
  backwards.at(-1).occurred_at = "2026-07-18T05:00:01Z";
  assert.equal(validateLifecycleSequence(backwards), false);

  const duplicateEvent = structuredClone(events);
  duplicateEvent.at(-1).event_id = duplicateEvent[0].event_id;
  assert.equal(validateLifecycleSequence(duplicateEvent), false);

  const wrongCommand = structuredClone(events);
  wrongCommand.at(-1).command_id = "018f47a0-7b2c-7c9d-8e1f-9123456789ab";
  assert.equal(validateLifecycleSequence(wrongCommand), false);
});
