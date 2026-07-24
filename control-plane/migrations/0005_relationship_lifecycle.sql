ALTER TABLE relationships
    ADD COLUMN ended_at timestamptz;

UPDATE relationships
SET ended_at = created_at
WHERE NOT active;

ALTER TABLE relationships
    ADD CONSTRAINT relationships_active_time_check
    CHECK (
        (active AND ended_at IS NULL)
        OR (NOT active AND ended_at IS NOT NULL AND ended_at >= created_at)
    );

CREATE INDEX relationship_invitations_retention_idx
    ON relationship_invitations (
        (COALESCE(used_at, invalidated_at, expires_at))
    );
