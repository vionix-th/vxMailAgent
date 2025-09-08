import { apiFetch, apiFetchRaw } from './utils/http';
/** Basic user profile information. */
type User = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  createdAt?: string;
  lastLoginAt?: string;
};

/** Retrieve the current authenticated user, if any. */
export async function whoAmI(): Promise<User | null> {
  try {
    const res = await apiFetchRaw('/api/auth/whoami');
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data.user as User;
  } catch {
    return null;
  }
}

/** Begin the Google OAuth login flow. */
export async function startGoogleLogin(): Promise<void> {
  const { url } = await apiFetch<{ url: string }>('/api/auth/google/initiate');
  if (!url) throw new Error('No login URL');
  window.location.href = url;
}

/** Terminate the current session. */
export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
}
