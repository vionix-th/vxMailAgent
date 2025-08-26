import React from 'react';
import { whoAmI } from './authClient';
import { useLocation, Navigate } from 'react-router-dom';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const me = await whoAmI();
      if (!mounted) return;
      setAuthed(!!me);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return null;
  if (!authed) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}
