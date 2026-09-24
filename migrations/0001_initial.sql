CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  collection TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video',
  period TEXT,
  duration_seconds REAL NOT NULL,
  bytes INTEGER NOT NULL,
  topics_json TEXT NOT NULL DEFAULT '[]',
  media_key TEXT NOT NULL,
  thumbnail_key TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS videos_collection_sort ON videos(published, collection, sort_key);

CREATE TABLE IF NOT EXISTS chapters (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  PRIMARY KEY (video_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS watch_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS watch_progress_recent ON watch_progress(user_id, updated_at DESC);
