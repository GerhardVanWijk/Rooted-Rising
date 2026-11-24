-- General attempt counter for rate limits (per IP, per email, per account).
CREATE TABLE attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX attempts_key ON attempts(key, at);
CREATE INDEX attempts_at ON attempts(at);
DROP TABLE login_failures;

-- Security log: logins, failures, sign-ups and password changes. Kept 90 days.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  email TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);

-- Session cookies are renamed to locked "__Host-" cookies, so old sessions are retired.
DELETE FROM sessions;
