type AudioSession = { type: string };
type PlaybackNavigator = {
  audioSession?: AudioSession;
  mediaSession?: Pick<MediaSession, 'playbackState' | 'setPositionState'>;
};
type MediaPosition = Pick<HTMLMediaElement, 'duration' | 'currentTime' | 'playbackRate' | 'paused' | 'ended'>;

/** Safari can expose Audio Session independently of Media Session. */
export function claimAudioPlayback(target: PlaybackNavigator): () => void {
  const session = target.audioSession;
  if (!session) return () => {};
  const previous = session.type;
  try { session.type = 'playback'; } catch { return () => {}; }
  return () => {
    try { if (session.type === 'playback') session.type = previous; } catch { /* Optional platform API. */ }
  };
}

/** Keep the OS controls in step with native media, including native pause/seek. */
export function syncMediaSession(target: PlaybackNavigator, player: MediaPosition): void {
  const session = target.mediaSession;
  if (!session) return;
  try { session.playbackState = player.paused || player.ended ? 'paused' : 'playing'; } catch { /* Optional platform API. */ }
  if (!Number.isFinite(player.duration) || player.duration <= 0 || !Number.isFinite(player.currentTime)
      || !Number.isFinite(player.playbackRate) || player.playbackRate <= 0) return;
  try {
    session.setPositionState?.({ duration: player.duration, playbackRate: player.playbackRate,
      position: Math.max(0, Math.min(player.currentTime, player.duration)) });
  } catch { /* Some browsers expose the API without position support. */ }
}
