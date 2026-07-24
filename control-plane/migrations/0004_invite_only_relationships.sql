CREATE TABLE relationship_invitations (
    invitation_id uuid PRIMARY KEY,
    inviter_id uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    invitation_digest bytea NOT NULL UNIQUE
        CHECK (octet_length(invitation_digest) = 32),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    invalidated_at timestamptz,
    created_at timestamptz NOT NULL,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    CHECK (used_at IS NULL OR used_at >= created_at),
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
    CHECK (used_at IS NULL OR invalidated_at IS NULL)
);

CREATE UNIQUE INDEX relationship_invitations_one_pending_per_inviter_idx
    ON relationship_invitations (inviter_id)
    WHERE used_at IS NULL AND invalidated_at IS NULL;
