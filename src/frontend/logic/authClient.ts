/**
 * Frontend auth helper: talks to the backend `/api/auth/*` endpoints.
 *
 * The session lives in an HttpOnly cookie set by the backend during the
 * GitHub OAuth callback, so the frontend never sees the JWT. This module
 * exposes the current user status (nickname + email + isAdmin) via
 * `/api/auth` and provides a way to (re)fetch it and trigger login/logout.
 */

export interface AuthUser {
  sub: string;
  nick: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  enabled: boolean;
  user: AuthUser | null;
}

/** Fetches the current auth status from the backend. */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch('/api/auth', { credentials: 'same-origin' });
    if (!res.ok) return { authenticated: false, enabled: false, user: null };
    const data = (await res.json()) as AuthStatus;
    return data;
  } catch {
    return { authenticated: false, enabled: false, user: null };
  }
}

/**
 * Starts GitHub OAuth login by redirecting to the backend-provided URL.
 * Returns false if auth is not configured on the server.
 */
export async function startLogin(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/login', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const data = (await res.json()) as { url?: string };
    if (!data.url) return false;
    window.location.href = data.url;
    return true;
  } catch {
    return false;
  }
}

/** Logs out by clearing the session cookie. */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // ignore – best effort
  }
}
