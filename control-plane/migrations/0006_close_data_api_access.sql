-- EJECT uses direct PostgreSQL connections, never the Supabase Data API.
-- No policies and no FORCE: the table owner retains application access.
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eject_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eject_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_delivery_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_eject_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_eject_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eject_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eject_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_enrollment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_request_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Plain PostgreSQL installations need not have the Supabase API roles.
-- Default privileges belong to the role executing this migration.
DO $$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I', api_role);
  END LOOP;
END
$$;
