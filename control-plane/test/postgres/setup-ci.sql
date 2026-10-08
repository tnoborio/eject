-- Disposable PostgreSQL 17 CI database only; run as the bootstrap superuser.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE eject_owner LOGIN PASSWORD 'eject' NOSUPERUSER NOBYPASSRLS;
-- Allow role-switch tests without inheriting the API roles' privileges.
GRANT anon, authenticated TO eject_owner WITH INHERIT FALSE, SET TRUE;
ALTER DATABASE eject_test OWNER TO eject_owner;
ALTER SCHEMA public OWNER TO eject_owner;
-- migrations.test.ts explicitly seeds table/sequence/function grants and
-- schema-scoped default grants inside its rollback-only regression fixture.
-- Schema resets would discard schema-scoped defaults installed here.
