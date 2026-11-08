-- Reading anchors belong to the viewer, independently of audio/video playback.
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL CHECK(position_seconds >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS reading_progress_recent ON reading_progress(user_id, updated_at DESC);
