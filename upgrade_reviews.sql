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
