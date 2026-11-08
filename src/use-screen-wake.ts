import { useEffect, useRef, useState } from 'react';
import { maintainScreenWake, type ScreenWakeStatus } from './screen-wake';

export function useScreenWake(enabled: boolean) {
  const [status, setStatus] = useState<ScreenWakeStatus>('off');
  const controller = useRef<ReturnType<typeof maintainScreenWake> | null>(null);
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    const owner = maintainScreenWake(document, window, navigator.wakeLock, setStatus);
    controller.current = owner;
    return () => {
      controller.current = null;
      owner.dispose();
    };
  }, [enabled]);
  return { status, retry: () => controller.current?.retry() };
}
