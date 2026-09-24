import type { Context } from 'hono';

export type Viewer = { id: number; username: string };
export type AppEnv = { Bindings: Env; Variables: { viewer: Viewer } };
type AppContext = Context<AppEnv>;

const SESSION_COOKIE = 'family_screen_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function passwordDigest(salt: string, password: string): Promise<string> {
  return sha256(`${salt}:${password}`);
}

export function equalDigest(left: string, right: string): boolean {
  if (left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function cookieValue(header: string | undefined): string | null {
  const part = header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return part?.slice(SESSION_COOKIE.length + 1) || null;
}

function cookieOptions(context: AppContext): string {
  const secure = new URL(context.req.url).protocol === 'https:' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export async function createSession(context: AppContext, userId: number): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await context.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, userId, expiresAt).run();
  context.header('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieOptions(context)}; Max-Age=${SESSION_SECONDS}`);
}

export async function getViewer(context: AppContext): Promise<Viewer | null> {
  const token = cookieValue(context.req.header('Cookie'));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  return context.env.DB.prepare(`
    SELECT users.id, users.username FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, Math.floor(Date.now() / 1000)).first<Viewer>();
}

export async function clearSession(context: AppContext): Promise<void> {
  const token = cookieValue(context.req.header('Cookie'));
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  context.header('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(context)}; Max-Age=0`);
}
