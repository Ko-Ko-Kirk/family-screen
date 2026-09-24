import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ChevronRight, CirclePlay, Clock3, Film, House, ListVideo,
  LogOut, Menu, Play, Search, SkipForward, Tv, X,
} from 'lucide-react';
import './style.css';

type Viewer = { id: number; username: string };
type Video = {
  id: string; title: string; collection: string; kind: string; period: string | null;
  duration_seconds: number; bytes: number; topics: string[]; sort_key: string;
  position_seconds: number | null; completed: number | null; updated_at: number | null;
};
type Chapter = { title: string; start_seconds: number };
type Tab = 'home' | 'continue' | 'collection';

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
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
      {!imageBroken && <img loading="lazy" src={`/thumbnails/${video.id}.jpg`} alt="" onError={() => setImageBroken(true)} />}
      {imageBroken && <div className="cover-fallback"><Film size={34} strokeWidth={1.5} /><span>{video.collection}</span></div>}
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
      <p className="login-footer">家人專屬的觀看空間</p>
    </section>
  </main>;
}

function WatchPage({ video, videos, chapters, onBack, onNext, onSelect, onProgress }: {
  video: Video; videos: Video[]; chapters: Chapter[]; onBack: () => void;
  onNext: () => void; onSelect: (video: Video) => void;
  onProgress: (id: string, position: number) => void;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const collection = videos.filter((item) => item.collection === video.collection);
  const next = collection[collection.findIndex((item) => item.id === video.id) + 1];
  useEffect(() => { lastSavedAt.current = 0; setAutoplayBlocked(false); setPlaybackError(false); }, [video.id]);
  function save(force = false) {
    const player = playerRef.current;
    if (!player || !Number.isFinite(player.currentTime) || player.currentTime < 0) return;
    const now = Date.now();
    if (!force && now - lastSavedAt.current < 15_000) return;
    lastSavedAt.current = now;
    onProgress(video.id, player.currentTime);
  }
  function loaded() {
    const player = playerRef.current;
    if (!player) return;
    if (video.position_seconds && video.position_seconds > 5 && video.position_seconds < video.duration_seconds - 6) {
      player.currentTime = video.position_seconds;
    }
    void player.play().catch(() => setAutoplayBlocked(true));
  }
  function ended() { onProgress(video.id, video.duration_seconds); if (autoNext && next) onNext(); }
  function chapterJump(seconds: number) {
    if (playerRef.current) { playerRef.current.currentTime = seconds; void playerRef.current.play(); }
  }
  return <main className="watch-layout">
    <div className="watch-main">
      <button className="back-link" onClick={onBack}><ArrowLeft size={18} /> 返回片庫</button>
      <div className="player-wrap">
        <video ref={playerRef} key={video.id} controls playsInline preload="metadata" poster={`/thumbnails/${video.id}.jpg`}
          src={`/media/${video.id}.mp4`} onLoadedMetadata={loaded} onTimeUpdate={() => save()}
          onPause={() => save(true)} onSeeked={() => save(true)} onEnded={ended} onError={() => setPlaybackError(true)} />
        {autoplayBlocked && !playbackError && <button className="player-overlay" onClick={() => { void playerRef.current?.play(); setAutoplayBlocked(false); }}><CirclePlay size={54} /> 點擊播放</button>}
        {playbackError && <div className="player-message">影片暫時無法播放，請檢查網路或稍後再試。</div>}
      </div>
      <div className="watch-heading"><div><span className="eyebrow">{video.collection}{video.period ? ` · ${video.period}` : ''}</span><h1>{video.title}</h1></div>{next && <button className="next-button" onClick={onNext}>下一集 <SkipForward size={17} /></button>}</div>
      <div className="watch-meta"><span><Clock3 size={15} /> {formatDuration(video.duration_seconds)}</span><span>{video.topics.slice(0, 3).join(' · ')}</span></div>
      {chapters.length > 0 && <section className="chapters"><h2>影片章節 <small>{chapters.length} 段</small></h2><div className="chapter-list">{chapters.map((chapter, index) => <button key={`${index}-${chapter.start_seconds}`} onClick={() => chapterJump(chapter.start_seconds)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{chapter.title}</strong><small>{formatDuration(chapter.start_seconds)}</small></button>)}</div></section>}
    </div>
    <aside className="watch-queue"><div className="queue-heading"><div><span className="eyebrow">接著播放</span><h2>{video.collection}</h2></div><label className="auto-toggle"><input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />自動連播</label></div><div className="queue-list">{collection.map((item, index) => <button key={item.id} className={`queue-item ${item.id === video.id ? 'is-current' : ''}`} onClick={() => onSelect(item)}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><span className="queue-thumb"><img loading="lazy" src={`/thumbnails/${item.id}.jpg`} alt="" /></span><span className="queue-copy"><strong>{item.title}</strong><small>{formatDuration(item.duration_seconds)}</small></span></button>)}</div></aside>
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

  function openVideo(video: Video) { setSelectedId(video.id); history.pushState({}, '', `/watch/${video.id}`); scrollTo(0, 0); }
  function back() { setSelectedId(null); history.pushState({}, '', '/'); scrollTo(0, 0); }
  function next() {
    if (!selected) return;
    const group = videos.filter((video) => video.collection === selected.collection);
    const nextVideo = group[group.findIndex((video) => video.id === selected.id) + 1];
    if (nextVideo) openVideo(nextVideo);
  }
  async function saveProgress(id: string, position: number) {
    try {
      await api(`/api/progress/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position_seconds: position }) });
      setVideos((old) => old.map((video) => video.id === id ? { ...video, position_seconds: position, completed: Number(position >= video.duration_seconds - 5), updated_at: Math.floor(Date.now() / 1000) } : video));
    } catch { /* Resume is best effort during a temporary connection loss. */ }
  }
  async function logout() {
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
    <header className="topbar"><div className="top-left"><button className="icon-button menu-button" aria-label="開啟選單" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={21} /></button><button className="brand" onClick={() => navigate('home')}><span className="brand-mark"><Play size={16} fill="currentColor" /></span><span>family<span className="brand-accent">screen</span></span></button></div><label className="search-box"><Search size={20} /><input value={query} onChange={(event) => { setQuery(event.target.value); if (selectedId) back(); }} placeholder="搜尋影片、主題或月份" aria-label="搜尋影片" />{query && <button aria-label="清除搜尋" onClick={() => setQuery('')}><X size={17} /></button>}</label><div className="account"><span className="account-avatar">{viewer.username.slice(0, 1).toUpperCase()}</span><span className="account-name">{viewer.username}</span><button className="icon-button" onClick={() => void logout()} title="登出" aria-label="登出"><LogOut size={19} /></button></div></header>
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="nav-group"><button className={tab === 'home' && !selected ? 'active' : ''} onClick={() => navigate('home')}><House size={20} />首頁</button><button className={tab === 'continue' && !selected ? 'active' : ''} onClick={() => navigate('continue')}><Clock3 size={20} />繼續觀看</button></div><div className="nav-divider" /><div className="nav-label">你的片庫</div><div className="nav-group"><button onClick={() => navigate('home', '全部')}><ListVideo size={20} />所有影片</button>{collections.slice(1).map((name) => <button key={name} className={collection === name && !selected ? 'active' : ''} onClick={() => navigate('collection', name)}><span className="nav-dot" />{name}</button>)}</div><div className="sidebar-bottom">由家人用心挑選的每一集。</div></aside>
    <div className="content-area">{selected ? <WatchPage key={selected.id} video={selected} videos={videos} chapters={chapters} onBack={back} onNext={next} onSelect={openVideo} onProgress={(id, position) => void saveProgress(id, position)} /> : <main className="library">
      {tab === 'home' && !query && resume.length > 0 && <section className="resume-section"><div className="section-head"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>繼續觀看</h2></div><button className="text-link" onClick={() => navigate('continue')}>查看全部 <ChevronRight size={16} /></button></div><div className="video-grid resume-grid">{resume.map((video) => <VideoCard key={video.id} video={video} onSelect={() => openVideo(video)} />)}</div></section>}
      <section className="catalog-section"><div className="section-head"><div><span className="eyebrow">YOUR FAMILY COLLECTION</span><h1>{query ? `搜尋「${query}」` : tab === 'continue' ? '繼續觀看' : collection === '全部' ? '為你挑選的影片' : collection}</h1><p>{query ? `${visible.length} 部符合的影片` : '想看哪一集，由你來選。'}</p></div><span className="count-pill">{visible.length} 部影片</span></div><div className="chips">{collections.map((name) => <button key={name} className={name === collection ? 'selected' : ''} onClick={() => { setCollection(name); if (tab === 'continue') setTab('home'); }}>{name}</button>)}</div>{error && <div className="load-error" role="alert">{error} <button onClick={() => void loadCatalog()}>重試</button></div>}{visible.length ? <div className="video-grid">{visible.map((video) => <VideoCard key={video.id} video={video} onSelect={() => openVideo(video)} />)}</div> : <div className="empty-state"><Film size={44} strokeWidth={1.4} /><h2>{videos.length ? '這裡還沒有符合的影片' : '片庫準備好了'}</h2><p>{videos.length ? '試著換個分類或搜尋字詞。' : '請家人使用匯入工具，加入挑選好的影片。'}</p></div>}</section>
    </main>}</div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
