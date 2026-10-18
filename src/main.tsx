import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ChevronRight, CirclePlay, Clock3, Film, House, ListVideo,
  Headphones, LogOut, Menu, Pause, Play, Search, SkipForward, Tv, X,
} from 'lucide-react';
import './style.css';
import { HomeScreenGuide } from './HomeScreenGuide';
import { collectionQueue, mediaPath, parseCaptions, resumeAudio, type Caption, type Playable } from './playback';
import { claimAudioPlayback, ensureAudioPlayback, setMediaSessionActions, syncMediaSession } from './media-session';
import { createPlaybackDiagnostics } from './playback-diagnostics';

type Viewer = { id: number; username: string };
type Video = Playable & {
  id: string; title: string; collection: string; kind: string; period: string | null;
  duration_seconds: number; bytes: number; topics: string[]; sort_key: string;
  position_seconds: number | null; completed: number | null; updated_at: number | null;
  has_subtitles?: number;
};
type Chapter = { title: string; start_seconds: number };
type Tab = 'home' | 'continue' | 'collection';
const DEMO_MODE = import.meta.env.MODE === 'demo';

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (DEMO_MODE) {
    const { demoApi } = await import('./demo');
    return demoApi<T>(path, options);
  }
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `伺服器回應 ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function VideoCard({ video, onSelect }: { video: Video; onSelect: () => void }) {
  const [imageBroken, setImageBroken] = useState(false);
  const progress = video.position_seconds && video.duration_seconds
    ? Math.min(100, (video.position_seconds / video.duration_seconds) * 100) : 0;
  return <button className="video-card" onClick={onSelect} aria-label={`播放 ${video.title}`}>
    <div className="video-cover">
      {video.media_type !== 'audio' && !imageBroken && <img loading="lazy" src={`/thumbnails/${video.id}.jpg`} alt="" onError={() => setImageBroken(true)} />}
      {(video.media_type === 'audio' || imageBroken) && <div className="cover-fallback">{video.media_type === 'audio' ? <Headphones size={34} /> : <Film size={34} strokeWidth={1.5} />}<span>{video.media_type === 'audio' ? '有聲書 · 音訊' : video.collection}</span></div>}
      <span className="duration-badge">{formatDuration(video.duration_seconds)}</span>
      {progress > 0 && <span className="progress-line" style={{ width: `${progress}%` }} />}
    </div>
    <div className="video-card-text">
      <span className="card-play"><Play size={18} fill="currentColor" /></span>
      <span className="card-copy"><strong>{video.title}</strong><small>{video.collection}{video.period ? ` · ${video.period}` : ''}</small></span>
    </div>
  </button>;
}

function Login({ onLogin }: { onLogin: (viewer: Viewer) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const viewer = await api<Viewer>('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      setPassword('');
      onLogin(viewer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    } finally { setBusy(false); }
  }
  return <main className="login-shell">
    <div className="login-art"><div className="login-art-inner"><Tv size={78} strokeWidth={1.1} /><span>每一集，都是家人挑選的。</span></div></div>
    <section className="login-panel">
      <div className="brand brand-login"><span className="brand-mark"><Play size={17} fill="currentColor" /></span><span>family<span className="brand-accent">screen</span></span></div>
      <div className="login-copy"><span className="eyebrow">PRIVATE FAMILY LIBRARY</span><h1>歡迎回家，<br />開始看喜歡的影片。</h1><p>輸入家人提供的帳號與密碼，繼續上次看到的地方。</p></div>
      <form onSubmit={submit} className="login-form">
        <label>帳號<input autoComplete="username" autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? '登入中…' : <>進入家庭片庫 <ChevronRight size={18} /></>}</button>
      </form>
      <HomeScreenGuide placement="login" />
      <p className="login-footer">家人專屬的觀看空間</p>
    </section>
  </main>;
}

function WatchPage({ video, videos, chapters, onBack, onNext, onSelect, onProgress }: {
  video: Video; videos: Video[]; chapters: Chapter[]; onBack: () => void;
  onNext: () => void; onSelect: (video: Video) => void;
  onProgress: (id: string, position: number) => void;
}) {
  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const lastSavedAt = useRef(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [mirrorMode, setMirrorMode] = useState(false);
  const [mirrorControlsVisible, setMirrorControlsVisible] = useState(true);
  const [controlsEpoch, setControlsEpoch] = useState(0);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration_seconds);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [captionError, setCaptionError] = useState(false);
  const [diagnosticText, setDiagnosticText] = useState('');
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [diagnostics] = useState(() => {
    try { return createPlaybackDiagnostics(localStorage); } catch { return createPlaybackDiagnostics(); }
  });
  const audioOnly = video.media_type === 'audio';
  const source = mediaPath(video);
  const collection = collectionQueue(videos, video);
  const next = collection[collection.findIndex((item) => item.id === video.id) + 1];
  const activeCaption = captions.find((cue) => cue.start <= currentTime && currentTime < cue.end);
  useEffect(() => { lastSavedAt.current = 0; setAutoplayBlocked(false); setPlaybackError(false); if (audioOnly) setMirrorMode(false); }, [video.id]);
  useLayoutEffect(() => {
    if (audioOnly) return claimAudioPlayback(navigator);
  }, [audioOnly]);
  useLayoutEffect(() => { refreshMediaControls(); }, [video.id, next?.id]);
  useLayoutEffect(() => {
    // Preserve the same audio element and request playback before waiting for metadata.
    // This also keeps a tap/ended/lock-screen next action in the playback call chain.
    if (audioOnly) play();
  }, [video.id, audioOnly]);
  useEffect(() => {
    const controller = new AbortController();
    setCaptions([]); setCaptionError(false);
    if (video.has_subtitles) void fetch(`/subtitles/${video.id}.vtt`, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Subtitle unavailable');
        const cues = parseCaptions(await response.text());
        if (!cues.length) throw new Error('Empty subtitles');
        setCaptions(cues);
      }).catch(() => { if (!controller.signal.aborted) setCaptionError(true); });
    return () => controller.abort();
  }, [video.id, video.has_subtitles]);
  useEffect(() => {
    const persist = () => save(true);
    const visibility = () => {
      trace(document.visibilityState === 'hidden' ? 'page:hidden' : 'page:visible');
      if (document.visibilityState === 'hidden') persist();
      else refreshMediaControls(); // Restore controls without resuming a user's pause.
    };
    const shown = () => { trace('page:show'); refreshMediaControls(); };
    const hidden = () => { trace('page:hide'); persist(); };
    window.addEventListener('pagehide', hidden);
    window.addEventListener('pageshow', shown);
    window.addEventListener('family-screen-save', persist);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', hidden);
      window.removeEventListener('pageshow', shown);
      window.removeEventListener('family-screen-save', persist);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [video.id]);
  useEffect(() => () => {
    trace('session:release');
    setMediaSessionActions(navigator, {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  }, []);
  useEffect(() => {
    if (!mirrorMode || paused || !mirrorControlsVisible) return;
    const timeout = window.setTimeout(() => setMirrorControlsVisible(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [mirrorMode, paused, mirrorControlsVisible, controlsEpoch]);
  useEffect(() => {
    if (!mirrorMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMirrorMode(false);
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', exitOnEscape);
    };
  }, [mirrorMode]);
  function save(force = false) {
    const player = playerRef.current;
    if (!player || !Number.isFinite(player.currentTime) || player.currentTime < 0) return;
    if (new URL(player.currentSrc || player.src, location.href).pathname !== source) return;
    const now = Date.now();
    if (!force && now - lastSavedAt.current < 15_000) return;
    lastSavedAt.current = now;
    onProgress(video.id, player.currentTime);
  }
  function loaded() {
    const player = playerRef.current;
    if (!player) return;
    player.playbackRate = playbackRate;
    setDuration(Number.isFinite(player.duration) ? player.duration : video.duration_seconds);
    const requestedTime = new URLSearchParams(location.search).get('t');
    if (requestedTime !== null && Number.isFinite(Number(requestedTime)) && Number(requestedTime) >= 0) {
      player.currentTime = Math.min(Number(requestedTime), Math.max(0, video.duration_seconds - 1));
    } else if (video.position_seconds && video.position_seconds > 0 && !video.completed) {
      player.currentTime = video.position_seconds;
    }
    setCurrentTime(player.currentTime);
    updateMediaSession();
    play();
  }
  function play() {
    const player = playerRef.current;
    if (!player) return;
    if (audioOnly) ensureAudioPlayback(navigator);
    trace('play:request');
    void player.play().then(() => trace('play:resolved')).catch((error: unknown) => {
      trace('play:rejected', error);
      // Changing a chapter can abort the previous element's pending play request.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (player === playerRef.current && new URL(player.currentSrc || player.src, location.href).pathname === source)
        setAutoplayBlocked(true);
    });
  }
  function updateMediaSession() {
    if (playerRef.current) syncMediaSession(navigator, playerRef.current);
  }
  function trace(event: Parameters<typeof diagnostics.record>[0], error?: unknown) {
    if (!audioOnly) return;
    const player = playerRef.current;
    const audioSession = (navigator as Navigator & { audioSession?: { state?: string } }).audioSession;
    const errorName = error instanceof Error ? error.name : undefined;
    diagnostics.record(event, { visible: document.visibilityState === 'visible',
      standalone: matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      paused: player?.paused, ended: player?.ended, position: player?.currentTime, ready: player?.readyState,
      session: navigator.mediaSession?.playbackState, audioState: audioSession?.state,
      error: errorName && ['AbortError','NotAllowedError','NotSupportedError','NetworkError'].includes(errorName) ? errorName : error ? 'OtherError' : undefined });
  }
  function refreshMediaControls() {
    if (!('mediaSession' in navigator)) return;
    // Action handlers must still work if metadata is unsupported. Never clear them on pause.
    if (typeof MediaMetadata !== 'undefined') {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: video.title, album: video.collection }); } catch { /* Optional metadata. */ }
    }
    setMediaSessionActions(navigator, {
      play: () => { trace('remote:play'); play(); },
      pause: () => { trace('remote:pause'); playerRef.current?.pause(); updateMediaSession(); },
      seekbackward: () => { trace('remote:seek'); seekTo((playerRef.current?.currentTime || 0) - 15); },
      seekforward: () => { trace('remote:seek'); seekTo((playerRef.current?.currentTime || 0) + 15); },
      seekto: (details) => { trace('remote:seek'); if (details.seekTime !== undefined) seekTo(details.seekTime); },
      nexttrack: next ? () => { trace('remote:next'); advance(); } : undefined,
    });
    updateMediaSession();
    trace('session:bind');
  }
  async function copyDiagnostics() {
    const text = diagnostics.export(); setDiagnosticText(text); setDiagnosticCopied(false);
    try { await navigator.clipboard.writeText(text); setDiagnosticCopied(true); } catch { /* The visible text can be copied manually. */ }
  }
  function advance() { if (audioOnly) flushSync(onNext); else onNext(); }
  function ended() { trace('media:ended'); updateMediaSession(); onProgress(video.id, video.duration_seconds); if (autoNext && next) advance(); }
  function chapterJump(seconds: number) {
    if (playerRef.current) { playerRef.current.currentTime = seconds; void playerRef.current.play(); }
  }
  function revealMirrorControls() {
    setMirrorControlsVisible(true);
    setControlsEpoch((previous) => previous + 1);
  }
  function enterMirrorMode() {
    const player = playerRef.current;
    // Commit the inline player before calling play(), while the tap is still a user gesture.
    flushSync(() => { setMirrorMode(true); revealMirrorControls(); });
    if (player) void player.play().catch(() => { if (player.paused) setAutoplayBlocked(true); });
  }
  function togglePlayback() {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) play();
    else player.pause();
    revealMirrorControls();
  }
  function seekTo(seconds: number) {
    const player = playerRef.current;
    if (!player || !Number.isFinite(seconds)) return;
    player.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(player.duration) ? player.duration : video.duration_seconds));
    setCurrentTime(player.currentTime);
    updateMediaSession();
    revealMirrorControls();
  }
  return <main className="watch-layout">
    <div className="watch-main">
      <button className="back-link" onClick={onBack}><ArrowLeft size={18} /> 返回片庫</button>
      <div className={`player-wrap${audioOnly ? ' audio-player' : ''}${mirrorMode ? ' mirror-mode' : ''}`}>
        {audioOnly && <div className="audio-art"><Headphones size={54} /><span>{video.topics.includes('AI 合成語音') ? '有聲書 · AI 合成語音' : '音訊播放'}</span><strong>{video.title}</strong></div>}
        {React.createElement(audioOnly ? 'audio' : 'video', {
          ref: playerRef, controls: !mirrorMode, playsInline: true, preload: 'metadata', autoPlay: audioOnly,
          poster: audioOnly ? undefined : `/thumbnails/${video.id}.jpg`, src: source, onLoadedMetadata: loaded,
          onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => { setCurrentTime(event.currentTarget.currentTime); updateMediaSession(); save(); },
          onPlay: () => { setPaused(false); setAutoplayBlocked(false); updateMediaSession(); trace('media:play'); },
          onPlaying: () => { refreshMediaControls(); trace('media:playing'); },
          onPause: () => { setPaused(true); updateMediaSession(); trace('media:pause'); save(true); },
          onDurationChange: updateMediaSession,
          onRateChange: updateMediaSession, onSeeked: () => { updateMediaSession(); save(true); }, onEnded: ended, onError: () => { trace('media:error'); setPlaybackError(true); },
        })}
        {autoplayBlocked && !playbackError && <button className="player-overlay" onClick={() => { void playerRef.current?.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true)); }}><CirclePlay size={54} /> 點擊播放</button>}
        {playbackError && <div className="player-message">媒體暫時無法播放，請檢查網路或稍後再試。</div>}
        {mirrorMode && <>
          <button className="mirror-tap" type="button" onClick={revealMirrorControls} aria-label="顯示播放控制" />
          <div className={`mirror-ui${mirrorControlsVisible || paused ? ' is-visible' : ''}`}>
            <button className="mirror-exit" type="button" onClick={() => setMirrorMode(false)} aria-label="退出電視鏡像全畫面"><X size={18} /> 退出全畫面</button>
            <div className="mirror-controls" aria-label="電視鏡像播放控制">
              <button type="button" onClick={togglePlayback} aria-label={paused ? '播放' : '暫停'}>{paused ? <Play size={21} fill="currentColor" /> : <Pause size={21} fill="currentColor" />}</button>
              <button type="button" onClick={() => seekTo(currentTime - 10)} aria-label="倒退 10 秒">−10</button>
              <span className="mirror-time">{formatDuration(currentTime)}</span>
              <input className="mirror-seek" type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(currentTime, duration)} onChange={(event) => seekTo(Number(event.target.value))} aria-label="播放進度" />
              <span className="mirror-time">{formatDuration(duration)}</span>
              <button type="button" onClick={() => seekTo(currentTime + 10)} aria-label="快轉 10 秒">+10</button>
              {next && <button type="button" onClick={onNext} aria-label="下一集"><SkipForward size={21} /></button>}
            </div>
          </div>
        </>}
      </div>
      {!mirrorMode && !audioOnly && <div className="player-actions"><button className="mirror-start" type="button" onClick={enterMirrorMode}><Tv size={18} /> 電視鏡像全畫面</button><span>鏡像輸出時按此播放；若要隱藏 Safari 工具列，請從分享選單加入主畫面，再由主畫面圖示開啟。</span></div>}
      {audioOnly && <div className="audio-actions"><button className="next-button" onClick={() => seekTo(currentTime - 15)}>倒退 15 秒</button><button className="next-button" onClick={() => seekTo(currentTime + 15)}>快轉 15 秒</button><label>播放速度 <select aria-label="播放速度" value={playbackRate} onChange={(event) => { const rate = Number(event.target.value); setPlaybackRate(rate); if (playerRef.current) playerRef.current.playbackRate = rate; }}>{[0.75,1,1.25,1.5,2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label></div>}
      {audioOnly && <details className="playback-help"><summary>耳機播放疑難排解</summary><p>若耳機恢復播放時跳到其他 App，請回到本頁點播放。也可用 Safari 開啟同一網站比較。iPhone 暫停後可能將播放控制交給其他 App。</p><button className="next-button" onClick={() => { refreshMediaControls(); play(); }}>恢復本頁播放</button><button className="next-button" onClick={() => void copyDiagnostics()}>{diagnosticCopied ? '已複製播放診斷' : '複製播放診斷'}</button><small>只記錄本機播放事件，不含帳密、媒體網址或內容；不會自動傳送。</small>{diagnosticText && <textarea aria-label="播放診斷紀錄" readOnly value={diagnosticText} />}</details>}
      {video.has_subtitles ? <section className="reader-captions" aria-label="字幕與跟讀文字"><button className="next-button" aria-pressed={captionsVisible} onClick={() => setCaptionsVisible(!captionsVisible)}>{captionsVisible ? '隱藏字幕' : '顯示字幕'}</button><small>正體中文 · {video.topics.includes('字幕時間估算') ? '分段時間為估算' : '跟讀字幕'}</small>{captionsVisible && <p>{captionError ? '字幕暫時無法載入，不影響音訊播放。' : activeCaption?.text || (captions.length ? (currentTime === 0 && paused ? '播放時顯示跟讀文字' : '\u00a0') : '載入字幕中…')}</p>}</section> : audioOnly ? <section className="reader-captions" aria-label="字幕狀態"><small>本章尚無字幕，仍可正常收聽。</small></section> : null}
      <div className="watch-heading"><div><span className="eyebrow">{video.collection}{video.period ? ` · ${video.period}` : ''}</span><h1>{video.title}</h1></div>{next && <button className="next-button" onClick={onNext}>下一集 <SkipForward size={17} /></button>}</div>
      <div className="watch-meta"><span><Clock3 size={15} /> {formatDuration(video.duration_seconds)}</span><span>{video.topics.slice(0, 3).join(' · ')}</span></div>
      {chapters.length > 0 && <section className="chapters"><h2>影片章節 <small>{chapters.length} 段</small></h2><div className="chapter-list">{chapters.map((chapter, index) => <button key={`${index}-${chapter.start_seconds}`} onClick={() => chapterJump(chapter.start_seconds)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{chapter.title}</strong><small>{formatDuration(chapter.start_seconds)}</small></button>)}</div></section>}
    </div>
    <aside className="watch-queue"><div className="queue-heading"><div><span className="eyebrow">接著播放</span><h2>{video.collection}</h2></div><label className="auto-toggle"><input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />自動連播</label></div><div className="queue-list">{collection.map((item, index) => <button key={item.id} className={`queue-item ${item.id === video.id ? 'is-current' : ''}`} onClick={() => onSelect(item)}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><span className="queue-thumb">{item.media_type === 'audio' ? <Headphones size={23} /> : <img loading="lazy" src={`/thumbnails/${item.id}.jpg`} alt="" />}</span><span className="queue-copy"><strong>{item.title}</strong><small>{formatDuration(item.duration_seconds)}</small></span></button>)}</div></aside>
  </main>;
}

function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [collection, setCollection] = useState('全部');
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState('');
  const progressRequests = useRef(new Map<string, Promise<void>>());

  async function loadCatalog() {
    try {
      const data = await api<{ videos: Video[] }>('/api/catalog');
      setVideos(data.videos);
      const route = /^\/watch\/([a-zA-Z0-9_-]+)$/.exec(location.pathname);
      if (route && data.videos.some((video) => video.id === route[1])) setSelectedId(route[1]);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '載入片庫失敗'); }
  }
  useEffect(() => {
    void api<Viewer>('/api/me').then(async (me) => { setViewer(me); await loadCatalog(); })
      .catch(() => setViewer(null)).finally(() => setLoading(false));
    const pop = () => setSelectedId(/^\/watch\/([a-zA-Z0-9_-]+)$/.exec(location.pathname)?.[1] || null);
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    void api<{ chapters: Chapter[] }>(`/api/videos/${selectedId}/chapters`).then((value) => setChapters(value.chapters)).catch(() => setChapters([]));
  }, [selectedId]);

  const selected = videos.find((video) => video.id === selectedId) || null;
  const collections = useMemo(() => ['全部', ...new Set(videos.map((video) => video.collection))], [videos]);
  const visible = useMemo(() => videos.filter((video) => {
    if (tab === 'continue' && (!video.position_seconds || video.completed)) return false;
    if (collection !== '全部' && video.collection !== collection) return false;
    const text = `${video.title} ${video.collection} ${video.period || ''} ${video.topics.join(' ')}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }).sort((a, b) => tab === 'continue' ? (b.updated_at || 0) - (a.updated_at || 0) : 0), [videos, tab, collection, query]);
  const resume = videos.filter((video) => video.position_seconds && !video.completed)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 4);
  const audioResume = resumeAudio(videos.filter((video) => collection === '全部' || video.collection === collection));

  function openVideo(video: Video) { dispatchEvent(new Event('family-screen-save')); setSelectedId(video.id); history.pushState({}, '', `/watch/${video.id}`); scrollTo(0, 0); }
  function back() { dispatchEvent(new Event('family-screen-save')); setSelectedId(null); history.pushState({}, '', '/'); scrollTo(0, 0); }
  function next() {
    if (!selected) return;
    const group = collectionQueue(videos, selected);
    const nextVideo = group[group.findIndex((video) => video.id === selected.id) + 1];
    if (nextVideo) openVideo(nextVideo);
  }
  async function saveProgress(id: string, position: number) {
    setVideos((old) => old.map((video) => video.id === id ? { ...video, position_seconds: position, completed: Number(position >= video.duration_seconds - (video.media_type === 'audio' ? 0.25 : 5)), updated_at: Math.floor(Date.now() / 1000) } : video));
    // Serialize writes for each chapter so a slower periodic save cannot overwrite an ending.
    const request = (progressRequests.current.get(id) || Promise.resolve()).then(async () => {
      await api(`/api/progress/${id}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position_seconds: position }) });
    }).catch(() => { /* A disconnected device may lose its latest save. */ });
    progressRequests.current.set(id, request);
    await request;
    if (progressRequests.current.get(id) === request) progressRequests.current.delete(id);
  }
  async function logout() {
    dispatchEvent(new Event('family-screen-save'));
    await Promise.all(progressRequests.current.values());
    await api('/api/logout', { method: 'POST' }).catch(() => undefined);
    setViewer(null); setVideos([]); back();
  }
  function navigate(nextTab: Tab, nextCollection = '全部') {
    setTab(nextTab); setCollection(nextCollection); setSidebarOpen(false);
    if (selectedId) back();
  }

  if (loading) return <div className="loading-screen"><span className="brand-mark"><Play size={20} fill="currentColor" /></span><span>正在打開家庭片庫…</span></div>;
  if (!viewer) return <Login onLogin={(me) => { setViewer(me); void loadCatalog(); }} />;
  return <div className="app-shell">
    <header className="topbar"><div className="top-left"><button className="icon-button menu-button" aria-label="開啟選單" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={21} /></button><button className="brand" onClick={() => navigate('home')}><span className="brand-mark"><Play size={16} fill="currentColor" /></span><span>family<span className="brand-accent">screen</span></span></button>{DEMO_MODE && <span className="demo-pill">SYNTHETIC DEMO</span>}</div><label className="search-box"><Search size={20} /><input value={query} onChange={(event) => { setQuery(event.target.value); if (selectedId) back(); }} placeholder="搜尋影音、主題或月份" aria-label="搜尋影音" />{query && <button aria-label="清除搜尋" onClick={() => setQuery('')}><X size={17} /></button>}</label><div className="account"><span className="account-avatar">{viewer.username.slice(0, 1).toUpperCase()}</span><span className="account-name">{viewer.username}</span>{!DEMO_MODE && <button className="icon-button" onClick={() => void logout()} title="登出" aria-label="登出"><LogOut size={19} /></button>}</div></header>
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="nav-group"><button className={tab === 'home' && !selected ? 'active' : ''} onClick={() => navigate('home')}><House size={20} />首頁</button><button className={tab === 'continue' && !selected ? 'active' : ''} onClick={() => navigate('continue')}><Clock3 size={20} />繼續觀看</button></div><div className="nav-divider" /><div className="nav-label">你的片庫</div><div className="nav-group"><button onClick={() => navigate('home', '全部')}><ListVideo size={20} />所有影音</button>{collections.slice(1).map((name) => <button key={name} className={collection === name && !selected ? 'active' : ''} onClick={() => navigate('collection', name)}><span className="nav-dot" />{name}</button>)}</div><div className="sidebar-bottom">{DEMO_MODE ? '本機示範：片單與影片皆為虛構。' : '由家人用心挑選的每一集。'}</div></aside>
    <div className="content-area">{selected ? <WatchPage video={selected} videos={videos} chapters={chapters} onBack={back} onNext={next} onSelect={openVideo} onProgress={(id, position) => void saveProgress(id, position)} /> : <main className="library">
      <HomeScreenGuide placement="library" />
      {audioResume && !query && <div className="audio-resume"><Headphones size={23} /><div><strong>接續上次收聽</strong><p>{audioResume.collection} · {audioResume.title}</p></div><button className="next-button" onClick={() => openVideo(audioResume)}>繼續收聽 <Play size={17} /></button></div>}
      {tab === 'home' && !query && resume.length > 0 && <section className="resume-section"><div className="section-head"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>繼續觀看</h2></div><button className="text-link" onClick={() => navigate('continue')}>查看全部 <ChevronRight size={16} /></button></div><div className="video-grid resume-grid">{resume.map((video) => <VideoCard key={video.id} video={video} onSelect={() => openVideo(video)} />)}</div></section>}
      <section className="catalog-section"><div className="section-head"><div><span className="eyebrow">YOUR FAMILY COLLECTION</span><h1>{query ? `搜尋「${query}」` : tab === 'continue' ? '繼續觀看' : collection === '全部' ? '為你挑選的影片' : collection}</h1><p>{query ? `${visible.length} 部符合的影片` : '想看哪一集，由你來選。'}</p></div><span className="count-pill">{visible.length} 部影音</span></div><div className="chips">{collections.map((name) => <button key={name} className={name === collection ? 'selected' : ''} onClick={() => { setCollection(name); if (tab === 'continue') setTab('home'); }}>{name}</button>)}</div>{error && <div className="load-error" role="alert">{error} <button onClick={() => void loadCatalog()}>重試</button></div>}{visible.length ? <div className="video-grid">{visible.map((video) => <VideoCard key={video.id} video={video} onSelect={() => openVideo(video)} />)}</div> : <div className="empty-state"><Film size={44} strokeWidth={1.4} /><h2>{videos.length ? '這裡還沒有符合的影片' : '片庫準備好了'}</h2><p>{videos.length ? '試著換個分類或搜尋字詞。' : '請家人使用匯入工具，加入挑選好的影片。'}</p></div>}</section>
    </main>}</div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
