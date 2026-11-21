CREATE TABLE sites (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  repo TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE reviewers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at TEXT,
  created_at TEXT
);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  site_slug TEXT NOT NULL REFERENCES sites(slug),
  reviewer_id TEXT NOT NULL REFERENCES reviewers(id),
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  last_opened_at TEXT,
  created_at TEXT,
  UNIQUE (site_slug, reviewer_id, path)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'later', 'kept')),
  note TEXT,
  pr_url TEXT,
  selector TEXT,
  element_text TEXT,
  element_x REAL,
  element_y REAL,
  page_x REAL,
  page_y REAL,
  viewport_w INTEGER,
  viewport_h INTEGER,
  device TEXT,
  screenshot_key TEXT,
  created_at TEXT,
  status_changed_at TEXT
);

CREATE INDEX idx_comments_assignment ON comments(assignment_id);
CREATE INDEX idx_assignments_reviewer ON assignments(reviewer_id);
