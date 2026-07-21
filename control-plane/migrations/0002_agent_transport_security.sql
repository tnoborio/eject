CREATE TABLE device_enrollment_sessions (
    enrollment_id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    enrollment_digest bytea NOT NULL UNIQUE CHECK (octet_length(enrollment_digest) = 32),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE TABLE device_keys (
    key_id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES registered_devices(device_id) ON DELETE CASCADE,
    algorithm text NOT NULL CHECK (algorithm = 'ECDSA_P256_SHA256_P1363'),
    public_key_spki bytea NOT NULL
        CHECK (octet_length(public_key_spki) BETWEEN 80 AND 120),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX device_keys_one_active_per_device_idx
    ON device_keys (device_id) WHERE revoked_at IS NULL;

CREATE TABLE device_request_nonces (
    device_id uuid NOT NULL REFERENCES registered_devices(device_id) ON DELETE CASCADE,
    nonce_digest bytea NOT NULL CHECK (octet_length(nonce_digest) = 32),
    accepted_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (device_id, nonce_digest),
    CHECK (expires_at > accepted_at AND expires_at <= accepted_at + interval '10 minutes')
);

CREATE INDEX device_request_nonces_expiry_idx
    ON device_request_nonces (expires_at);

ALTER TABLE eject_commands DROP CONSTRAINT eject_commands_status_check;
ALTER TABLE eject_commands ADD CONSTRAINT eject_commands_status_check
    CHECK (status IN (
        'QUEUED', 'DISPATCHED', 'DELIVERED', 'REJECTED_BY_AGENT', 'ATTEMPTED',
        'CANCELLED', 'EXPIRED', 'FAILED', 'OUTCOME_UNKNOWN'
    ));
ALTER TABLE eject_commands ADD CONSTRAINT eject_commands_command_device_unique
    UNIQUE (command_id, device_id);

CREATE TABLE agent_results (
    device_id uuid NOT NULL,
    command_id uuid NOT NULL,
    request_fingerprint char(64) NOT NULL
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    recorded_at timestamptz NOT NULL,
    disposition text NOT NULL CHECK (disposition IN ('REJECTED', 'ATTEMPTED')),
    attempt_count integer NOT NULL CHECK (attempt_count IN (0, 1)),
    result_code text NOT NULL CHECK (result_code IN (
        'INVALID_COMMAND', 'AUDIENCE_MISMATCH', 'COMMAND_EXPIRED',
        'COMMAND_ISSUED_IN_FUTURE', 'COMMAND_REPLAYED', 'AGENT_PAUSED',
        'NO_APPROVED_DRIVE', 'COMMAND_UNSUPPORTED', 'COMMAND_ACCEPTED',
        'DRIVE_NOT_FOUND', 'DRIVE_BUSY', 'DRIVE_NOT_READY',
        'DRIVE_UNSUPPORTED', 'DRIVE_DISCONNECTED', 'ACCESS_DENIED', 'FAILED'
    )),
    physical_outcome text NOT NULL
        CHECK (physical_outcome IN ('NOT_ATTEMPTED', 'UNKNOWN')),
    received_at timestamptz NOT NULL,
    PRIMARY KEY (device_id, command_id),
    FOREIGN KEY (command_id, device_id)
        REFERENCES eject_commands(command_id, device_id),
    CHECK (
        (disposition = 'REJECTED' AND attempt_count = 0
            AND physical_outcome = 'NOT_ATTEMPTED'
            AND result_code IN (
                'INVALID_COMMAND', 'AUDIENCE_MISMATCH', 'COMMAND_EXPIRED',
                'COMMAND_ISSUED_IN_FUTURE', 'COMMAND_REPLAYED', 'AGENT_PAUSED',
                'NO_APPROVED_DRIVE', 'COMMAND_UNSUPPORTED'
            ))
        OR
        (disposition = 'ATTEMPTED' AND attempt_count = 1
            AND physical_outcome = 'UNKNOWN'
            AND result_code IN (
                'COMMAND_ACCEPTED', 'DRIVE_NOT_FOUND', 'DRIVE_BUSY',
                'DRIVE_NOT_READY', 'DRIVE_UNSUPPORTED', 'DRIVE_DISCONNECTED',
                'ACCESS_DENIED', 'FAILED'
            ))
    )
);

CREATE INDEX agent_results_received_idx ON agent_results (received_at);
