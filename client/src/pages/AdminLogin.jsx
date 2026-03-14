import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { hasAdminToken, setAdminToken } from '../lib/adminAuth';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/admin';

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (hasAdminToken()) {
    return <Navigate to="/admin" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/admin/login', { username, password });
      const token = res?.data?.token;
      if (!token) throw new Error('No token returned');
      setAdminToken(token);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="futura-panel overflow-hidden max-w-md mx-auto">
      <div className="h-[3px] w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
      <header className="px-5 pt-4 pb-3 border-b border-slate-100">
        <h1 className="text-lg font-black text-slate-900">Admin Login</h1>
        <p className="text-xs text-slate-500 mt-1">Sign in to access the admin panel.</p>
      </header>

      <form onSubmit={submit} className="p-5 space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
            autoComplete="username"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
            autoComplete="current-password"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="futura-btn text-sm px-5 py-2.5 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
