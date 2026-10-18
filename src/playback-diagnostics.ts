const key = 'family-screen-playback-diagnostics-v1';
const events = ['session:bind', 'session:release', 'remote:play', 'remote:pause', 'remote:seek', 'remote:next',
  'play:request', 'play:resolved', 'play:rejected', 'media:play', 'media:playing', 'media:pause', 'media:ended',
  'media:error', 'page:visible', 'page:hidden', 'page:show', 'page:hide'] as const;
type Event = typeof events[number];
type Snapshot = { visible?: boolean; standalone?: boolean; paused?: boolean; ended?: boolean; position?: number;
  ready?: number; session?: string; audioState?: string; error?: string };
type Entry = Snapshot & { at: number; event: Event };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Explicit fields only: never persist URLs, titles, account data, or error messages.
function sanitize(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (!events.includes(input.event as Event) || typeof input.at !== 'number' || !Number.isFinite(input.at)) return null;
  const entry: Entry = { at: input.at, event: input.event as Event };
  for (const name of ['visible', 'standalone', 'paused', 'ended'] as const)
    if (typeof input[name] === 'boolean') entry[name] = input[name];
  if (typeof input.position === 'number' && Number.isFinite(input.position)) entry.position = Math.max(0, Math.round(input.position));
  if (typeof input.ready === 'number' && Number.isInteger(input.ready) && input.ready >= 0 && input.ready <= 4) entry.ready = input.ready;
  if (['none','paused','playing'].includes(String(input.session))) entry.session = String(input.session);
  if (['inactive','active','interrupted'].includes(String(input.audioState))) entry.audioState = String(input.audioState);
  if (['AbortError','NotAllowedError','NotSupportedError','NetworkError','OtherError'].includes(String(input.error))) entry.error = String(input.error);
  return entry;
}

export function createPlaybackDiagnostics(storage?: StorageLike) {
  let entries: Entry[] = [];
  try {
    const stored = storage?.getItem(key);
    if (stored && stored.length <= 30_000) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) entries = parsed.slice(-60).map(sanitize).filter((entry): entry is Entry => Boolean(entry));
    }
  } catch { /* Diagnostics must not interfere with playback. */ }
  return {
    record(event: Event, snapshot: Snapshot) {
      const entry = sanitize({ ...snapshot, event, at: Date.now() });
      if (!entry) return;
      entries = [...entries, entry].slice(-60);
      try { storage?.setItem(key, JSON.stringify(entries)); } catch { /* Storage may be disabled. */ }
    },
    export() { return JSON.stringify({ version: 1, entries }, null, 2); },
  };
}
