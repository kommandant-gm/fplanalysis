import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../lib/adminAuth';
import ManualSync from './ManualSync';
import AnalyticsLive from './AnalyticsLive';

export default function AdminPanel() {
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await axios.post('/api/admin/logout');
    } catch {
      // Stateless auth; client token removal is enough.
    } finally {
      clearAdminToken();
      navigate('/admin/login', { replace: true });
    }
  };

  return (
    <div className="space-y-5">
      <section className="futura-panel overflow-hidden">
        <div className="h-[3px] w-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500" />
        <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-slate-900">Admin Panel</h1>
            <p className="text-xs text-slate-500 mt-1">
              Internal controls for sync and traffic analytics.
            </p>
          </div>
          <button onClick={logout} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Logout
          </button>
        </header>
      </section>

      <ManualSync />
      <AnalyticsLive />
    </div>
  );
}
