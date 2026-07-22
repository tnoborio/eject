ALTER TABLE registered_devices
    DROP CONSTRAINT registered_devices_owner_id_key;

CREATE UNIQUE INDEX registered_devices_one_active_per_owner_idx
    ON registered_devices (owner_id)
    WHERE enrollment_state <> 'REVOKED';

ALTER TABLE registered_devices
    ADD COLUMN platform text NOT NULL DEFAULT 'WINDOWS'
        CHECK (platform = 'WINDOWS'),
    ADD COLUMN agent_version varchar(32) NOT NULL DEFAULT '0.0.0'
        CHECK (agent_version ~ '^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$');

CREATE INDEX device_enrollment_sessions_owner_pending_idx
    ON device_enrollment_sessions (owner_id, expires_at)
    WHERE used_at IS NULL;
