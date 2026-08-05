/**
 * Authentication: GitHub OAuth + JWT (HS256) sessions.
 *
 * - Login is ONLY via GitHub OAuth. We store only the user's nickname
 *   and email address (no password, no avatar, no access token).
 * - A signed JWT (HS256) is issued on login. It carries `sub` (a stable
 *   user id derived from the GitHub id), `nick`, `email`, `isAdmin`,
 *   `iat` and `exp` (max 7 days). The token is stored client-side
 *   (localStorage) and sent as a Bearer token.
 * - Admin rights are determined by a user's email being in the
 *   `DOT_ADMIN_EMAILS` env list (or a DB `users.is_admin` flag).
 *
 * JWT is hand-rolled on top of `node:crypto` (HMAC-SHA256) to avoid
 * adding a dependency.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sqlite, sqliteEnabled } from './sqliteStore';

// --- Env / config ---------------------------------------------------------

const JWT_SECRET = process.env.DOT_JWT_SECRET || '';
/** Comma-separated emails granted admin access (bootstrap). */
const ADMIN_EMAILS: ReadonlySet<string> = new Set(
  (process.env.DOT_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER = 'https://api.github.com/user';

/** Whether OAuth is configured (client id + secret + a JWT secret). */
export function authEnabled(): boolean {
  return Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && JWT_SECRET);
}

export interface AuthUser {
  sub: string;        // stable id (derived from github id)
  nick: string;
  email: string;
  isAdmin: boolean;
}

// --- JWT (HS256) ----------------------------------------------------------

function b64urlEncode(data: string | Buffer): string {
  return Buffer.from(data as any)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function sign(headerPayload: string): string {
  return createHmac('sha256', JWT_SECRET).update(headerPayload).digest('base64url');
}

/** Issues a signed JWT valid for `SESSION_DAYS` days. */
export function issueToken(user: AuthUser): string {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlEncode(
    JSON.stringify({
      sub: user.sub,
      nick: user.nick,
      email: user.email,
      isAdmin: user.isAdmin,
      iat: now,
      exp: now + SESSION_DAYS * 24 * 60 * 60,
    })
  );
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(signingInput)}`;
}

/** Verifies a JWT and returns the decoded user claims, or null if invalid/expired. */
export function verifyToken(token: string): AuthUser | null {
  if (!JWT_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts as [string, string, string];

  const expected = sign(`${headerB64}.${payloadB64}`);
  const sigBuf = Buffer.from(signature, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64)) as {
      sub: string; nick: string; email: string; isAdmin: boolean;
      exp?: number; iat?: number;
    };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      sub: payload.sub,
      nick: payload.nick ?? '',
      email: payload.email ?? '',
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch {
    return null;
  }
}

// --- User storage / admin -------------------------------------------------

/** Ensures the `users` table exists. */
export function ensureUsersTable(): void {
  if (!sqliteEnabled) return;
  const db = sqlite();
  if (!db) return;
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY,
        githubId INTEGER NOT NULL,
        nick TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        is_admin INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
    `);
  } catch (e) {
    console.error('[Auth] Failed to ensure users table', e);
  }
}

/** Looks up a user by `sub` from the DB (fallback: null). */
function dbGetUser(sub: string): { githubId: number; nick: string; email: string; isAdmin: boolean } | null {
  if (!sqliteEnabled) return null;
  const db = sqlite();
  if (!db) return null;
  try {
    const row = db.query(
      'SELECT githubId, nick, email, is_admin AS isAdmin FROM users WHERE sub = ?'
    ).get(sub) as any;
    if (!row) return null;
    return {
      githubId: row.githubId as number,
      nick: row.nick as string,
      email: (row.email as string) ?? '',
      isAdmin: Boolean(row.isAdmin),
    };
  } catch {
    return null;
  }
}

/** Persists a user, updating nick/email if already present. Returns AuthUser. */
function dbUpsertUser(sub: string, githubId: number, nick: string, email: string): AuthUser {
  const isAdmin = isAdminEmail(email) || (dbGetUser(sub)?.isAdmin ?? false);
  if (sqliteEnabled) {
    const db = sqlite();
    if (db) {
      try {
        db.query(`
          INSERT INTO users (sub, githubId, nick, email, is_admin, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(sub) DO UPDATE SET
            nick = excluded.nick,
            email = excluded.email
        `).run(sub, githubId, nick, email, isAdmin ? 1 : 0, Date.now());
      } catch (e) {
        console.error('[Auth] Failed to persist user', e);
      }
    }
  }
  return { sub, nick, email, isAdmin };
}

/** Whether the given email is in the admin allow-list (case-insensitive). */
export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}

/** Builds the stable `sub` from a GitHub numeric id. */
function subForGithub(githubId: number): string {
  return `gh:${githubId}`;
}

/**
 * Exchanges a GitHub OAuth `code` for a user. Returns null on any failure.
 * Only persists `nick` and `email` (explicitly NOT the access token).
 */
export async function exchangeGithubCode(code: string): Promise<AuthUser | null> {
  if (!authEnabled()) return null;

  // 1. Code -> access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) return null;

  // 2. Token -> user profile
  const userRes = await fetch(GITHUB_API_USER, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/json' },
  });
  if (!userRes.ok) return null;
  const gh = (await userRes.json()) as {
    id?: number; login?: string; email?: string | null;
  };
  if (!gh.id || !gh.login) return null;

  const sub = subForGithub(gh.id);
  const nick = gh.login;
  const email = (gh.email || '').trim();
  return dbUpsertUser(sub, gh.id, nick, email);
}

/** Fetches the current user from a Bearer token, or null. */
export function userFromAuthHeader(authHeader: string | null): AuthUser | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return verifyToken(token);
}

/** Builds the GitHub OAuth authorize URL with the given state. */
export function githubAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.PUBLIC_ORIGIN || ''}/api/auth/github/callback`,
    scope: 'user:email',
    state,
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export const SESSION_MAX_AGE_MS = SESSION_MS;
