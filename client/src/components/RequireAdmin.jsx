import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { clearAdminToken, hasAdminToken } from '../lib/adminAuth';

export default function RequireAdmin({ children }) {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let active = true;

    if (!hasAdminToken()) {
      setStatus('unauthorized');
      return undefined;
    }

    axios.get('/api/admin/me')
      .then(() => {
        if (active) setStatus('authorized');
      })
      .catch(() => {
        clearAdminToken();
        if (active) setStatus('unauthorized');
      });

    return () => {
      active = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <section className="futura-panel p-6">
        <p className="text-sm text-slate-500">Checking admin session...</p>
      </section>
    );
  }

  if (status === 'unauthorized') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
