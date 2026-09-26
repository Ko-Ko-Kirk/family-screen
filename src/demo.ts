// Local, synthetic data only. This module is loaded in Vite's demo mode, never by the Worker.
type DemoVideo = {
  id: string; title: string; collection: string; kind: 'video'; period: null;
  duration_seconds: number; bytes: number; topics: string[]; sort_key: string;
};

const videos: DemoVideo[] = [
  { id: 'demo-colors-01', title: '顏色探險', collection: '探索時間', kind: 'video', period: null, duration_seconds: 20, bytes: 0, topics: ['顏色', '觀察'], sort_key: '01' },
  { id: 'demo-shapes-02', title: '形狀遊戲', collection: '探索時間', kind: 'video', period: null, duration_seconds: 20, bytes: 0, topics: ['形狀', '遊戲'], sort_key: '02' },
  { id: 'demo-stars-03', title: '夜空小旅行', collection: '想像故事', kind: 'video', period: null, duration_seconds: 20, bytes: 0, topics: ['星星', '想像'], sort_key: '01' },
  { id: 'demo-numbers-04', title: '一起數到十', collection: '一起學習', kind: 'video', period: null, duration_seconds: 20, bytes: 0, topics: ['數字', '節奏'], sort_key: '01' },
];

const chapters: Record<string, { title: string; start_seconds: number }[]> = {
  'demo-colors-01': [{ title: '開始探索', start_seconds: 0 }, { title: '看看不同的顏色', start_seconds: 10 }],
  'demo-shapes-02': [{ title: '開始遊戲', start_seconds: 0 }, { title: '找找形狀', start_seconds: 10 }],
  'demo-stars-03': [{ title: '出發', start_seconds: 0 }, { title: '抬頭看星空', start_seconds: 10 }],
  'demo-numbers-04': [{ title: '一起數數', start_seconds: 0 }, { title: '再數一次', start_seconds: 10 }],
};

type Progress = { position_seconds: number; updated_at: number };
const storageKey = 'family-screen-synthetic-demo-progress';

function readProgress(): Record<string, Progress> {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as Record<string, Progress>;
  } catch { /* An empty demo still works if local storage is unavailable. */ }
  return { 'demo-colors-01': { position_seconds: 7, updated_at: Math.floor(Date.now() / 1000) - 3600 } };
}

export async function demoApi<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  if (path === '/api/me' || (path === '/api/login' && method === 'POST')) {
    return { id: 1, username: 'demo' } as T;
  }
  if (path === '/api/catalog') {
    const progress = readProgress();
    return { videos: videos.map((video) => {
      const entry = progress[video.id];
      return {
        ...video,
        position_seconds: entry?.position_seconds ?? null,
        completed: entry ? Number(entry.position_seconds >= video.duration_seconds - 5) : null,
        updated_at: entry?.updated_at ?? null,
      };
    }) } as T;
  }
  const chapterId = /^\/api\/videos\/([a-z0-9-]+)\/chapters$/.exec(path)?.[1];
  if (chapterId && chapters[chapterId]) return { chapters: chapters[chapterId] } as T;
  const progressId = /^\/api\/progress\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (progressId && method === 'PUT' && videos.some((video) => video.id === progressId)) {
    const body = JSON.parse(String(options?.body)) as { position_seconds: number };
    const progress = readProgress();
    progress[progressId] = { position_seconds: body.position_seconds, updated_at: Math.floor(Date.now() / 1000) };
    localStorage.setItem(storageKey, JSON.stringify(progress));
    return { ok: true } as T;
  }
  if (path === '/api/logout' && method === 'POST') return { ok: true } as T;
  throw new Error('Demo route not found');
}
