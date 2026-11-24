-- Accounts: customers sign up themselves; superusers are created by the owner only.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'superuser')),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Login sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- Each customer's Car Companion data (car, records, reminders) as JSON.
CREATE TABLE user_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Failed login attempts, used to slow down password guessing.
CREATE TABLE login_failures (
  email TEXT NOT NULL COLLATE NOCASE,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_email ON login_failures(email, at);
