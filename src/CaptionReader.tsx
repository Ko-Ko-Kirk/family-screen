import { useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Pause, Play, SkipForward, X } from 'lucide-react';
import { activeCaptionIndex, type Caption } from './playback';

type Props = {
  chapterId: string; title: string; collection: string; captions: Caption[];
  currentTime: number; duration: number; paused: boolean; playbackRate: number;
  loadingError: boolean; playbackError: boolean;
  onClose: () => void; onTogglePlayback: () => void; onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void; onNext?: () => void;
};

const timeLabel = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/** A viewport-sized reading dialog. The original audio element keeps playing outside it. */
export function CaptionReader(props: Props) {
  const { chapterId, title, collection, captions, currentTime, duration, paused, playbackRate,
    loadingError, playbackError, onClose, onTogglePlayback, onSeek, onRateChange, onNext } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const initialScroll = useRef(true);
  const [following, setFollowing] = useState(true);
  const [fontSize, setFontSize] = useState(28);
  const index = activeCaptionIndex(captions, currentTime);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    initialScroll.current = true;
    setFollowing(true);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [chapterId]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const cue = currentRef.current;
    if (!following || !scroll || !cue) return;
    const centerCue = () => {
      const top = scroll.scrollTop + cue.getBoundingClientRect().top - scroll.getBoundingClientRect().top
        - (scroll.clientHeight - cue.offsetHeight) / 2;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroll.scrollTo({ top: Math.max(0, top), behavior: initialScroll.current || reducedMotion ? 'instant' : 'smooth' });
      initialScroll.current = false;
    };
    centerCue();
    // Recenter after a phone rotation or a browser toolbar changes the viewport height.
    const observer = new ResizeObserver(centerCue);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [chapterId, index, following, fontSize]);

  return <dialog ref={dialogRef} className="caption-reader" aria-labelledby="caption-reader-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key === ' ' && !(event.target instanceof Element && event.target.closest('button, input, select'))) {
        event.preventDefault(); onTogglePlayback();
      }
    }}>
    <header className="caption-reader-header">
      <div className="caption-reader-heading"><span><BookOpen size={16} /> 全螢幕跟讀 · {collection}</span><h2 id="caption-reader-title">{title}</h2></div>
      <button className="caption-reader-close" type="button" onClick={onClose} aria-label="退出全螢幕字幕" autoFocus><X size={24} /></button>
    </header>
    <div className="caption-reader-tools">
      <button className={`caption-follow${following ? ' is-following' : ''}`} type="button" aria-pressed={following}
        onClick={() => setFollowing(!following)}>{following ? '跟隨朗讀中' : '回到朗讀位置'}</button>
      <span className="caption-reader-hint">點選句子可跳轉</span>
      <div className="caption-font-controls" aria-label="字幕字級">
        <button type="button" aria-label="縮小字幕" disabled={fontSize <= 20} onClick={() => setFontSize((size) => Math.max(20, size - 4))}>A−</button>
        <button type="button" aria-label="放大字幕" disabled={fontSize >= 44} onClick={() => setFontSize((size) => Math.min(44, size + 4))}>A＋</button>
      </div>
    </div>
    <div ref={scrollRef} className="caption-scroll" role="region" aria-label="跟讀字幕全文" tabIndex={0}
      onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false); }}>
      {captions.length ? <ol className="caption-lines" style={{ fontSize: `${fontSize}px` }}>
        {captions.map((cue, cueIndex) => <li key={`${chapterId}-${cueIndex}`}>
          <button ref={cueIndex === index ? currentRef : undefined} type="button"
            className={`caption-cue${cueIndex === index ? ' is-active' : ''}${cue.end <= currentTime ? ' is-read' : ''}`}
            aria-current={cueIndex === index ? 'true' : undefined}
            onClick={() => { setFollowing(true); onSeek(cue.start); }}>
            <span className="caption-cue-time">{timeLabel(cue.start)}</span><span>{cue.text}</span>
          </button>
        </li>)}
      </ol> : <p className="caption-reader-empty" role="status">{loadingError ? '字幕暫時無法載入，音訊仍可播放。請退出後重新整理再試。' : '正在載入跟讀字幕…'}</p>}
    </div>
    <footer className="caption-reader-player">
      {playbackError && <p className="caption-reader-error" role="alert">音訊暫時無法播放，請檢查網路或稍後再試。</p>}
      <div className="caption-reader-timeline"><span>{timeLabel(currentTime)}</span>
        <input type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(currentTime, duration)}
          onChange={(event) => { setFollowing(true); onSeek(Number(event.target.value)); }}
          aria-label="字幕播放進度" aria-valuetext={`${timeLabel(currentTime)}，共 ${timeLabel(duration)}`} />
        <span>{timeLabel(duration)}</span></div>
      <div className="caption-reader-controls">
        <button type="button" onClick={() => { setFollowing(true); onSeek(currentTime - 15); }} aria-label="倒退 15 秒">−15<span>秒</span></button>
        <button className="caption-reader-play" type="button" onClick={onTogglePlayback} aria-label={paused ? '播放音訊' : '暫停音訊'}>{paused ? <Play size={28} fill="currentColor" /> : <Pause size={28} fill="currentColor" />}</button>
        <button type="button" onClick={() => { setFollowing(true); onSeek(currentTime + 15); }} aria-label="快轉 15 秒">+15<span>秒</span></button>
        <select value={playbackRate} onChange={(event) => onRateChange(Number(event.target.value))} aria-label="跟讀播放速度">
          {[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        {onNext && <button type="button" onClick={onNext} aria-label="下一集"><SkipForward size={24} /></button>}
      </div>
    </footer>
  </dialog>;
}
