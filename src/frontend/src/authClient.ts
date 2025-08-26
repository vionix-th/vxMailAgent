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
    const res = await fetch('/api/auth/whoami', { credentials: 'include' });
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
  const res = await fetch('/api/auth/google/initiate');
  if (!res.ok) throw new Error('Failed to initiate login');
  const { url } = await res.json();
  if (!url) throw new Error('No login URL');
  window.location.href = url;
}

/** Terminate the current session. */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}
