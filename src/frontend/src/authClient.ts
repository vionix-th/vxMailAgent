type User = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  createdAt?: string;
  lastLoginAt?: string;
};

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

export async function startGoogleLogin(): Promise<void> {
  const res = await fetch('/api/auth/google/initiate');
  if (!res.ok) throw new Error('Failed to initiate login');
  const { url } = await res.json();
  if (!url) throw new Error('No login URL');
  window.location.href = url;
}
