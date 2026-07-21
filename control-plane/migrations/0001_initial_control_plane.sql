CREATE TABLE people (
    person_id uuid PRIMARY KEY,
    display_name varchar(80) NOT NULL CHECK (display_name <> ''),
    account_status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (account_status IN ('ACTIVE', 'RESTRICTED')),
    participation_state text NOT NULL DEFAULT 'ACCOUNT_ONLY'
        CHECK (participation_state IN ('ACCOUNT_ONLY', 'SETUP_IN_PROGRESS', 'PARTICIPATION_READY', 'REVOKED')),
    availability text NOT NULL DEFAULT 'OFFLINE'
        CHECK (availability IN ('AVAILABLE', 'PAUSED', 'OFFLINE')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE relationships (
    person_low_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    person_high_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (person_low_id, person_high_id),
    CHECK (person_low_id::text < person_high_id::text)
);

CREATE TABLE eject_grants (
    recipient_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (recipient_id, actor_id),
    CHECK (recipient_id <> actor_id)
);

CREATE TABLE eject_blocks (
    recipient_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (recipient_id, actor_id),
    CHECK (recipient_id <> actor_id)
);

CREATE TABLE recipient_access_policies (
    recipient_id uuid PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
    audience_scope text NOT NULL DEFAULT 'NAMED'
        CHECK (audience_scope IN ('NAMED', 'CONNECTED', 'ALL_AUTHENTICATED')),
    sender_eligibility text NOT NULL DEFAULT 'READY_PARTICIPANTS_ONLY'
        CHECK (sender_eligibility IN ('READY_PARTICIPANTS_ONLY', 'AUTHENTICATED_ACCOUNTS')),
    paused boolean NOT NULL DEFAULT false,
    selected_hourly_limit integer NOT NULL DEFAULT 0 CHECK (selected_hourly_limit >= 0),
    cooldown_seconds integer NOT NULL DEFAULT 60 CHECK (cooldown_seconds BETWEEN 0 AND 86400),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipient_entitlements (
    recipient_id uuid PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
    inbound_hourly_ceiling integer NOT NULL CHECK (inbound_hourly_ceiling >= 0),
    valid_until timestamptz,
    source_version varchar(100) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE registered_devices (
    device_id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    enrollment_state text NOT NULL DEFAULT 'SETUP_IN_PROGRESS'
        CHECK (enrollment_state IN ('SETUP_IN_PROGRESS', 'READY', 'REVOKED')),
    availability text NOT NULL DEFAULT 'OFFLINE'
        CHECK (availability IN ('AVAILABLE', 'PAUSED', 'OFFLINE')),
    has_approved_drive boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id)
);

CREATE TABLE system_delivery_policy (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    delivery_enabled boolean NOT NULL DEFAULT false,
    physical_hourly_ceiling integer CHECK (physical_hourly_ceiling >= 0),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_delivery_policy (singleton) VALUES (true);

CREATE TABLE recipient_eject_state (
    recipient_id uuid PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
    window_started_at timestamptz NOT NULL,
    accepted_in_window integer NOT NULL DEFAULT 0 CHECK (accepted_in_window >= 0),
    cooldown_until timestamptz,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sender_eject_state (
    actor_id uuid PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
    window_started_at timestamptz NOT NULL,
    accepted_in_window integer NOT NULL DEFAULT 0 CHECK (accepted_in_window >= 0),
    hourly_limit integer NOT NULL DEFAULT 5 CHECK (hourly_limit >= 0),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE eject_requests (
    request_id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES people(person_id),
    recipient_id uuid NOT NULL REFERENCES people(person_id),
    idempotency_key uuid NOT NULL,
    request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    action text NOT NULL CHECK (action IN ('EJECT', 'EJECT_BACK')),
    reply_to_command_id uuid,
    outcome text NOT NULL CHECK (outcome IN ('REJECTED', 'QUEUED')),
    rejection_reason text CHECK (rejection_reason IN (
        'PERMISSION_REQUIRED', 'RECIPIENT_PAUSED', 'QUIET_HOURS_ACTIVE',
        'COOLDOWN_ACTIVE', 'RATE_LIMITED', 'DEVICE_UNAVAILABLE', 'ACTOR_RESTRICTED'
    )),
    command_id uuid,
    created_at timestamptz NOT NULL,
    UNIQUE (actor_id, idempotency_key),
    CHECK (
        (outcome = 'REJECTED' AND rejection_reason IS NOT NULL AND command_id IS NULL)
        OR (outcome = 'QUEUED' AND rejection_reason IS NULL AND command_id IS NOT NULL)
    ),
    CHECK (
        (action = 'EJECT' AND reply_to_command_id IS NULL)
        OR (action = 'EJECT_BACK' AND reply_to_command_id IS NOT NULL)
    )
);

CREATE TABLE eject_commands (
    command_id uuid PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE REFERENCES eject_requests(request_id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES people(person_id),
    recipient_id uuid NOT NULL REFERENCES people(person_id),
    device_id uuid NOT NULL REFERENCES registered_devices(device_id),
    command_type text NOT NULL DEFAULT 'OPTICAL_DRIVE_EJECT'
        CHECK (command_type = 'OPTICAL_DRIVE_EJECT'),
    status text NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'DISPATCHED', 'DELIVERED', 'ATTEMPTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'OUTCOME_UNKNOWN')),
    reply_to_command_id uuid UNIQUE REFERENCES eject_commands(command_id),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    cancellation_reason text CHECK (cancellation_reason IN ('PERMISSION_REVOKED', 'DEVICE_REVOKED', 'DELIVERY_DISABLED')),
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '60 seconds'),
    CHECK ((status = 'CANCELLED') = (cancellation_reason IS NOT NULL))
);

ALTER TABLE eject_requests
    ADD CONSTRAINT eject_requests_command_fk
    FOREIGN KEY (command_id) REFERENCES eject_commands(command_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE eject_lifecycle_events (
    event_id uuid PRIMARY KEY,
    request_id uuid NOT NULL REFERENCES eject_requests(request_id) ON DELETE CASCADE,
    command_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN (
        'REQUESTED', 'REJECTED', 'AUTHORIZED', 'QUEUED', 'DISPATCHED', 'DELIVERED',
        'REJECTED_BY_AGENT', 'ATTEMPTED', 'EXPIRED', 'CANCELLED', 'FAILED', 'OUTCOME_UNKNOWN'
    )),
    reason_code text,
    occurred_at timestamptz NOT NULL,
    UNIQUE (request_id, state, occurred_at)
);

CREATE INDEX eject_commands_recipient_status_idx
    ON eject_commands (recipient_id, status);
CREATE INDEX eject_lifecycle_events_command_time_idx
    ON eject_lifecycle_events (command_id, occurred_at);
