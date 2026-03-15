import { useEffect, useState } from 'react';
import axios from 'axios';

function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function StatCard({ label, value }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
    </article>
  );
}

export default function AnalyticsLive() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await axios.get('/api/analytics/summary');
      setData(res.data);
      setError('');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="futura-panel overflow-hidden">
      <div className="h-[3px] w-full bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500" />
      <header className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">Live Analytics</h1>
          <p className="text-xs text-slate-500 mt-1">
            Active users, total visits and top pages.
          </p>
        </div>
        <button onClick={load} className="futura-btn text-sm px-4 py-2 rounded-xl">
          Refresh
        </button>
      </header>

      <div className="p-4 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-500">Loading analytics...</p>
        ) : error ? (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Active Now" value={data?.stats?.activeNow ?? 0} />
              <StatCard label="Total Visits" value={data?.stats?.totalVisits ?? 0} />
              <StatCard label="Total Sessions" value={data?.stats?.totalSessions ?? 0} />
            </div>

            <article className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <header className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-800">Top Pages</p>
              </header>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500">Path</th>
                      <th className="text-right px-3 py-2 text-slate-500">Views</th>
                      <th className="text-right px-3 py-2 text-slate-500">Unique</th>
                      <th className="text-left px-3 py-2 text-slate-500">Last Visited</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data?.pages || []).map((row) => (
                      <tr key={row.path}>
                        <td className="px-3 py-2 font-semibold text-slate-800">{row.path}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.views}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.uniqueVisitors}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(row.lastVisited)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <header className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-800">Recent Visits</p>
              </header>
              <div className="max-h-80 overflow-auto divide-y divide-slate-100">
                {(data?.recent || []).map((r, i) => (
                  <div key={`${r.sessionId}-${r.createdAt}-${i}`} className="px-4 py-2 text-xs">
                    <p className="font-semibold text-slate-800">{r.path}</p>
                    <p className="text-slate-500 mt-0.5">
                      {r.sessionId?.slice(0, 8)}... - {fmtDate(r.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </>
        )}
      </div>
    </section>
  );
}
