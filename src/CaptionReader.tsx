import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Headphones, Pause, Play, SkipForward, X } from 'lucide-react';
import { activeCaptionIndex, type Caption } from './playback';
import { readingParagraphIndex, readingParagraphs, type ReaderMode } from './reading';
import type { ReadingIllustration } from './illustrations';

type Props = {
  chapterId: string; title: string; collection: string; captions: Caption[];
  currentTime: number; duration: number; paused: boolean; playbackRate: number;
  mode: ReaderMode; readingPosition: number; onModeChange: (mode: ReaderMode, position: number) => void;
  onReadingProgress: (seconds: number) => Promise<void>;
  loadingError: boolean; playbackError: boolean;
  onClose: () => void; onTogglePlayback: () => void; onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void; onNext?: () => void;
  illustrations: ReadingIllustration[]; illustrationError: boolean;
};

const timeLabel = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/** Both views share the original audio element and the captions' acoustic anchors. */
export function CaptionReader(props: Props) {
  const { chapterId, title, collection, captions, currentTime, duration, paused, playbackRate,
    mode, readingPosition, onModeChange, onReadingProgress,
    loadingError, playbackError, onClose, onTogglePlayback, onSeek, onRateChange, onNext, illustrations, illustrationError } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const cueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const initialScroll = useRef(true);
  const readyToRead = useRef(false);
  const readingViewport = useRef({ width: 0, height: 0 });
  const anchor = useRef(readingPosition);
  const pendingSave = useRef<number | undefined>(undefined);
  const lastSaved = useRef<number | undefined>(undefined);
  const requestVersion = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const [following, setFollowing] = useState(true);
  const [fontSize, setFontSize] = useState(() => matchMedia('(max-width: 680px)').matches ? 24 : 28);
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [sync, setSync] = useState<'saved' | 'saving' | 'failed'>('saved');
  const paragraphs = useMemo(() => readingParagraphs(captions, illustrations.map(i=>i.before_cue)), [captions, illustrations]);
  const index = activeCaptionIndex(captions, currentTime);
  const cueIndices = useMemo(() => new Map(captions.map((cue, i) => [cue, i])), [captions]);

  function flushReading() {
    clearTimeout(timer.current);
    const position = pendingSave.current;
    if (position === undefined || position === lastSaved.current) return;
    pendingSave.current = undefined;
    const version = ++requestVersion.current;
    setSync('saving');
    void onReadingProgress(position).then(() => {
      lastSaved.current = position;
      if (version === requestVersion.current) setSync('saved');
    }).catch(() => {
      if (version === requestVersion.current) { if (pendingSave.current === undefined) pendingSave.current = position; setSync('failed'); }
    });
  }
  function remember(position: number) {
    anchor.current = position;
    if (position === lastSaved.current) return;
    pendingSave.current = position; setSync('saving');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flushReading, 700);
  }
  function close() { flushReading(); onClose(); }
  function changeMode(next: ReaderMode) {
    if (next === mode) return;
    flushReading();
    onModeChange(next, next === 'read' ? currentTime : anchor.current);
  }
  function listenHere() { flushReading(); onModeChange('listen', anchor.current); }
  const imageSource = (file: string) => import.meta.env.MODE === 'demo'
    ? '/thumbnails/demo-shapes-02.jpg' : `/media/reading-images/${chapterId}/${file}`;
  function imagesBefore(cueIndex: number) {
    return illustrations.filter(image=>image.before_cue===cueIndex).map((image,i)=><figure key={`${image.file}-${i}`}
      className={`reading-illustration${image.decorative?' is-decoration':''}`} style={{maxWidth:image.decorative?64:image.width}}>
      <a href={imageSource(image.file)} target="_blank" rel="noopener noreferrer" aria-label={image.alt || '放大書中圖片'} style={{aspectRatio:`${image.width} / ${image.height}`}}>
        <img src={imageSource(image.file)} alt={image.alt} width={image.width} height={image.height}
          loading="lazy" decoding="async" onError={event=>{event.currentTarget.hidden=true;event.currentTarget.closest('figure')?.classList.add('image-unavailable');}} />
        <span className="reading-image-error">圖片暫時無法載入</span>
      </a>
    </figure>);
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close(); document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const flush = () => flushReading();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    addEventListener('pagehide', flush); addEventListener('family-screen-save', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush(); removeEventListener('pagehide', flush); removeEventListener('family-screen-save', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [chapterId]);
  useLayoutEffect(() => {
    initialScroll.current = true; setFollowing(true); readyToRead.current = false;
    if (mode === 'read') anchor.current = readingPosition;
  }, [chapterId, mode, readingPosition]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (mode !== 'read' || !scroll || !paragraphs.length) return;
    let frame = 0;
    const restoreSentence = () => {
      // Folding, rotation and Safari's toolbar can reflow text without user scrolling.
      // Keep the acoustic sentence anchor instead of reusing a pixel scroll offset.
      readyToRead.current = false;
      const chosen = readingParagraphIndex(paragraphs, anchor.current);
      const cueIndex = captions.findIndex((cue) => cue.start > anchor.current);
      const chosenCue = cueIndex === -1 ? captions.length - 1 : Math.max(0, cueIndex - 1);
      const sentence = cueRefs.current[chosenCue] || paragraphRefs.current[chosen];
      if (!sentence) return;
      scroll.scrollTop += sentence.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24;
      readingViewport.current = { width: scroll.clientWidth, height: scroll.clientHeight };
      anchor.current = captions[chosenCue].start; setParagraphIndex(chosen);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { readyToRead.current = true; remember(anchor.current); });
    };
    restoreSentence();
    const observer = new ResizeObserver(() => {
      const { width, height } = readingViewport.current;
      if (width !== scroll.clientWidth || height !== scroll.clientHeight) restoreSentence();
    });
    observer.observe(scroll);
    window.addEventListener('resize', restoreSentence);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', restoreSentence);
    };
  }, [chapterId, mode, paragraphs, fontSize, readingPosition]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current; const cue = currentRef.current;
    if (mode !== 'listen' || !following || !scroll || !cue) return;
    const centerCue = () => {
      const top = scroll.scrollTop + cue.getBoundingClientRect().top - scroll.getBoundingClientRect().top
        - (scroll.clientHeight - cue.offsetHeight) / 2;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroll.scrollTo({ top: Math.max(0, top), behavior: initialScroll.current || reducedMotion ? 'instant' : 'smooth' });
      initialScroll.current = false;
    };
    centerCue(); const observer = new ResizeObserver(centerCue); observer.observe(scroll);
    return () => observer.disconnect();
  }, [chapterId, index, following, fontSize, mode]);
  function trackReading() {
    const scroll = scrollRef.current;
    if (mode !== 'read' || !readyToRead.current || !scroll || !paragraphs.length) return;
    const { width, height } = readingViewport.current;
    // Ignore the layout-generated scroll event even if it arrives before ResizeObserver.
    if (width !== scroll.clientWidth || height !== scroll.clientHeight) return;
    const top = scroll.getBoundingClientRect().top + 28;
    let chosen = 0;
    for (let i = 0; i < paragraphRefs.current.length; i++) {
      const paragraph = paragraphRefs.current[i];
      if (paragraph && paragraph.getBoundingClientRect().top <= top) chosen = i;
      else break;
    }
    if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2) chosen = paragraphs.length - 1;
    let chosenCue = 0;
    for (let i = 0; i < cueRefs.current.length; i++) {
      const cue = cueRefs.current[i];
      if (cue && cue.getBoundingClientRect().top <= top) chosenCue = i;
      else break;
    }
    setParagraphIndex(chosen); remember(captions[chosenCue].start);
  }
  const percent = Math.round(paragraphIndex / Math.max(1, paragraphs.length) * 100);
  return <dialog ref={dialogRef} className={`caption-reader${mode === 'read' ? ' is-reading' : ''}`} aria-labelledby="caption-reader-title"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onKeyDown={(event) => {
      if (mode === 'listen' && event.key === ' ' && !(event.target instanceof Element && event.target.closest('button, input, select'))) {
        event.preventDefault(); onTogglePlayback();
      }
    }}>
    <header className="caption-reader-header">
      <div className="caption-reader-heading"><span><BookOpen size={16} /> {collection}</span><h2 id="caption-reader-title">{title}</h2></div>
      <button className="caption-reader-close" type="button" onClick={close} aria-label="退出全螢幕閱讀" autoFocus><X size={24} /></button>
    </header>
    <div className="reader-mode-switch" role="group" aria-label="全螢幕模式">
      <button type="button" aria-pressed={mode === 'listen'} onClick={() => changeMode('listen')}><Headphones size={20} /> 聆聽</button>
      <button type="button" aria-pressed={mode === 'read'} onClick={() => changeMode('read')}><BookOpen size={20} /> 閱讀</button>
    </div>
    <div className="caption-reader-tools">
      {mode === 'listen' ? <>
        <button className={`caption-follow${following ? ' is-following' : ''}`} type="button" aria-pressed={following}
          onClick={() => setFollowing(!following)}>{following ? '跟隨朗讀中' : '回到朗讀位置'}</button>
        <span className="caption-reader-hint">點選句子可跳轉</span>
      </> : <span className="reading-sync" role="status">{sync === 'failed' ? <>進度尚未同步 <button type="button" onClick={flushReading}>重試</button></>
        : sync === 'saving' ? '正在保存閱讀位置…' : '閱讀位置已保存至帳號'}</span>}
      <div className="caption-font-controls" aria-label="文字字級">
        <button type="button" aria-label="縮小文字" disabled={fontSize <= 20} onClick={() => setFontSize((size) => Math.max(20, size - 4))}>A−</button>
        <button type="button" aria-label="放大文字" disabled={fontSize >= 44} onClick={() => setFontSize((size) => Math.min(44, size + 4))}>A＋</button>
      </div>
    </div>
    <div ref={scrollRef} className="caption-scroll" role="region" aria-label={mode === 'read' ? '章節閱讀全文' : '跟讀字幕全文'} tabIndex={0}
      onScroll={trackReading} onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false); }}>
      {captions.length ? mode === 'read' ? <article className="reading-prose" style={{ fontSize: `${fontSize}px` }}>
        {illustrationError && <p className="reading-image-note">本章圖片暫時無法載入，文字仍可閱讀。</p>}
        {paragraphs.map((paragraph, i) => <Fragment key={`${chapterId}-${paragraph.start}`}>
          {imagesBefore(cueIndices.get(paragraph.cues[0])!)}
          <p ref={(element) => { paragraphRefs.current[i] = element; }}
          data-paragraph-start={paragraph.start}>{paragraph.cues.map((cue, j) => <span key={cue.start}
            ref={(element) => { cueRefs.current[cueIndices.get(cue)!] = element; }} data-reading-start={cue.start}>
            {j > 0 && /[\p{L}\p{N}]$/u.test(paragraph.cues[j - 1].text) && /^[A-Za-z0-9]/.test(cue.text) ? ' ' : ''}{cue.text}
          </span>)}</p></Fragment>)}
        {imagesBefore(captions.length)}
        {onNext && <button className="reading-next-chapter" type="button" onClick={() => { flushReading(); onNext(); }}>閱讀下一章 <SkipForward size={20} /></button>}
      </article> : <ol className="caption-lines" style={{ fontSize: `${fontSize}px` }}>
        {captions.map((cue, cueIndex) => <li key={`${chapterId}-${cueIndex}`}>
          <button ref={cueIndex === index ? currentRef : undefined} type="button"
            className={`caption-cue${cueIndex === index ? ' is-active' : ''}${cue.end <= currentTime ? ' is-read' : ''}`}
            aria-current={cueIndex === index ? 'true' : undefined}
            onClick={() => { setFollowing(true); onSeek(cue.start); }}>
            <span className="caption-cue-time">{timeLabel(cue.start)}</span><span>{cue.text}</span>
          </button>
        </li>)}
      </ol> : <p className="caption-reader-empty" role="status">{loadingError ? '文字暫時無法載入。請退出後重新整理再試。' : '正在載入章節文字…'}</p>}
    </div>
    {mode === 'read' ? <footer className="reading-footer">
      <div><strong>朗讀已暫停</strong><span>本章 {percent}% · 可從目前位置開始聽</span></div>
      <button className="reading-listen-here" type="button" disabled={!paragraphs.length} onClick={listenHere}><Play size={20} fill="currentColor" /> 從這裡聽</button>
      {onNext && <button className="reading-next" type="button" onClick={() => { flushReading(); onNext(); }} aria-label="閱讀下一章"><SkipForward size={22} /></button>}
    </footer> : <footer className="caption-reader-player">
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
    </footer>}
  </dialog>;
}
