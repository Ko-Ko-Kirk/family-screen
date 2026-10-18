type AudioSession = { type: string };
type PlaybackNavigator = {
  audioSession?: AudioSession;
  mediaSession?: Partial<Pick<MediaSession, 'playbackState' | 'setPositionState' | 'setActionHandler'>>;
};
type MediaPosition = Pick<HTMLMediaElement, 'duration' | 'currentTime' | 'playbackRate' | 'paused' | 'ended'>;
export type PlaybackActions = Partial<Record<MediaSessionAction, MediaSessionActionHandler>>;

/** Re-register directly, without a null-handler gap when the chapter changes. */
export function setMediaSessionActions(target: PlaybackNavigator, actions: PlaybackActions): void {
  for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'] as const) {
    try { target.mediaSession?.setActionHandler?.(action, actions[action] || null); } catch { /* Optional device action. */ }
  }
}

export function ensureAudioPlayback(target: PlaybackNavigator): void {
  try { if (target.audioSession && target.audioSession.type !== 'playback') target.audioSession.type = 'playback'; }
  catch { /* Optional platform API. */ }
}

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
