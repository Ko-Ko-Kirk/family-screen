-- Existing video IDs and per-account progress remain unchanged.
ALTER TABLE videos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video' CHECK(media_type IN ('video','audio'));
ALTER TABLE videos ADD COLUMN media_format TEXT NOT NULL DEFAULT 'mp4' CHECK(media_format IN ('mp4','mp3','m4a'));
ALTER TABLE videos ADD COLUMN subtitle_key TEXT;
