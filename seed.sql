-- 本機開發用。三個帳號的演示密碼皆為 ReviewDemo2026。
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
SET LOCAL search_path TO submission_app;

INSERT INTO users (name, email, password_hash, role)
SELECT name, email, public.crypt('ReviewDemo2026', public.gen_salt('bf', 12)), role
FROM (VALUES
    ('作者一', 'author1@example.test', 'author'),
    ('作者二', 'author2@example.test', 'author'),
    ('編輯一', 'editor@example.test', 'editor')
) AS demo(name, email, role)
ON CONFLICT (email) DO NOTHING;

COMMIT;
