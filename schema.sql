BEGIN;

CREATE SCHEMA IF NOT EXISTS submission_app;
SET LOCAL search_path TO submission_app;

CREATE TABLE IF NOT EXISTS users (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('author', 'editor'))
);

CREATE TABLE IF NOT EXISTS submissions (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_id integer NOT NULL REFERENCES users (id),
    category text NOT NULL CHECK (btrim(category) <> ''),
    title text NOT NULL CHECK (btrim(title) <> ''),
    content text NOT NULL CHECK (btrim(content) <> ''),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_review', 'approved'))
);

CREATE INDEX IF NOT EXISTS submissions_author_idx ON submissions (author_id);
CREATE INDEX IF NOT EXISTS submissions_review_idx ON submissions (id)
    WHERE status = 'in_review';

COMMIT;

-- 既有資料庫升級時可單獨執行 upgrade_reviews.sql。
BEGIN;
SET LOCAL search_path TO submission_app;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS revision_note text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS review_history (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submission_id integer REFERENCES submissions(id) ON DELETE SET NULL,
    editor_id integer NOT NULL REFERENCES users(id),
    author_name text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved', 'returned')),
    revision_note text NOT NULL DEFAULT '',
    reviewed_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE INDEX IF NOT EXISTS review_history_editor_idx ON review_history(editor_id, id);
COMMIT;
