export type ScreenWakeStatus = 'off' | 'unsupported' | 'requesting' | 'active' | 'released' | 'failed';

type VisibleDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
type PageEvents = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Own one foreground screen lock. A late response must never outlive its fullscreen view. */
export function maintainScreenWake(
  doc: VisibleDocument, page: PageEvents, wake: Pick<WakeLock, 'request'> | undefined,
  report: (status: ScreenWakeStatus) => void,
) {
  let disposed = false;
  let pageActive = true;
  let epoch = 0;
  let pending = false;
  let current: WakeLockSentinel | null = null;
  const visible = () => pageActive && doc.visibilityState === 'visible';
  const release = (lock: WakeLockSentinel) => { void lock.release().catch(() => undefined); };

  function drop() {
    epoch++; pending = false;
    const lock = current; current = null;
    if (lock && !lock.released) release(lock);
  }
  async function acquire() {
    // The browser can mark a lock released before delivering its queued event.
    if (current?.released) current = null;
    if (disposed || !visible() || pending || current) return;
    if (!wake) { report('unsupported'); return; }
    const version = ++epoch;
    pending = true; report('requesting');
    try {
      const lock = await wake.request('screen');
      if (disposed || version !== epoch || !visible()) { release(lock); return; }
      current = lock;
      lock.addEventListener('release', () => {
        if (current !== lock) return;
        current = null;
        if (!disposed) report('released');
        // A system refusal/release is not retried in a loop. Visibility return or
        // the reader's retry button is the next opportunity to request a lock.
      }, { once: true });
      if (lock.released) { current = null; report('released'); }
      else report('active');
    } catch {
      if (!disposed && version === epoch) report('failed');
    } finally {
      if (version === epoch) pending = false;
    }
  }
  const visibility = () => {
    if (visible()) void acquire();
    else { drop(); report(wake ? 'released' : 'unsupported'); }
  };
  const hide = () => { pageActive = false; drop(); report(wake ? 'released' : 'unsupported'); };
  const show = () => { pageActive = true; if (visible()) void acquire(); };
  doc.addEventListener('visibilitychange', visibility);
  page.addEventListener('pagehide', hide);
  page.addEventListener('pageshow', show);
  if (!wake) report('unsupported');
  else if (visible()) void acquire();
  else report('released');
  return {
    retry: () => { void acquire(); },
    dispose() {
      disposed = true; drop();
      doc.removeEventListener('visibilitychange', visibility);
      page.removeEventListener('pagehide', hide);
      page.removeEventListener('pageshow', show);
    },
  };
}
