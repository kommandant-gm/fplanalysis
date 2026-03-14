import { useState } from 'react';
import axios from 'axios';

export default function ManualSync() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const runSync = async () => {
    setRunning(true);
    setResult('');
    setError('');
    try {
      const res = await axios.post('/api/sync');
      setResult(res?.data?.message || 'Sync completed');
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Sync failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="futura-panel overflow-hidden max-w-2xl mx-auto">
      <div className="h-[3px] w-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400" />
      <header className="px-5 pt-4 pb-3 border-b border-slate-100">
        <h1 className="text-lg font-black text-slate-900">Manual Sync Control</h1>
        <p className="text-xs text-slate-500 mt-1">
          Trigger a full FPL sync from the admin panel.
        </p>
      </header>

      <div className="p-5 space-y-3">
        <button
          onClick={runSync}
          disabled={running}
          className="futura-btn text-sm px-5 py-2.5 rounded-xl disabled:opacity-50"
        >
          {running ? 'Syncing...' : 'Run Sync Now'}
        </button>

        {result && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {result}
          </p>
        )}

        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
