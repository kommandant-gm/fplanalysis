import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POS_COLOR = {
  1: 'bg-slate-100 text-slate-700 border border-slate-200',
  2: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  3: 'bg-cyan-50 text-cyan-700 border border-cyan-100',
  4: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100',
};
const FDR_PILL = {
  1: 'bg-emerald-500 text-white',
  2: 'bg-emerald-400 text-white',
  3: 'bg-amber-300 text-amber-900',
  4: 'bg-orange-400 text-white',
  5: 'bg-red-600 text-white',
};
const POSITIONS = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'];

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posFilter, setPosFilter] = useState('ALL');
  const [gameweek, setGameweek] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = posFilter !== 'ALL' ? { pos: posFilter } : {};
    axios.get('/api/players', { params })
      .then((res) => {
        setPlayers(res.data.data || []);
        setGameweek(res.data.gameweek);
      })
      .catch(() => setError('Could not load players. Is the server running?'))
      .finally(() => setLoading(false));
  }, [posFilter]);

  return (
    <div className="space-y-6">
      <div className="reveal-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">Data Explorer</p>
        <h1 className="text-3xl font-black tracking-tight text-slate-900 mt-1">Players</h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Detailed player model view with form, fixture and expected points
          {gameweek ? ` for GW${gameweek}` : ''}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm reveal-up">
          {error}
        </div>
      )}

      <div className="futura-panel overflow-hidden reveal-up delay-1">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-sky-50/70 to-white">
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              {loading ? 'Player Projections' : `${players.length} Player Projections`}
            </h2>
            <p className="text-xs text-slate-500 mt-1">Sorted by xPts, with likely and ceiling points</p>
          </div>
          <div className="flex gap-1 bg-sky-50 p-1 rounded-lg border border-sky-100">
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  posFilter === pos
                    ? 'bg-gradient-to-r from-[#0a84ff] to-[#00c4ff] text-white shadow-[0_8px_16px_rgba(10,132,255,0.22)]'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100">
                <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">#</th>
                <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Player</th>
                <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Pos</th>
                <th className="text-right px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Price</th>
                <th className="text-right px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Form</th>
                <th className="text-center px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">FDR</th>
                <th className="text-right px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">xPts</th>
                <th className="text-right px-5 py-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Pred / Ceiling</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(9)].map((__, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-3.5 rounded-md skeleton-shimmer" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-slate-500 text-sm">
                    No data. Sync from the dashboard first.
                  </td>
                </tr>
              ) : (
                players.map((p, i) => (
                  <tr key={p.id} className="hover:bg-sky-50/40 transition-colors">
                    <td className="px-5 py-3.5 text-xs text-slate-500 font-medium">{i + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.team}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-semibold ${POS_COLOR[p.position]}`}>
                        {POS_LABEL[p.position]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-700">GBP {parseFloat(p.price).toFixed(1)}m</td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-700">{parseFloat(p.form).toFixed(1)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${FDR_PILL[p.fdr] || 'bg-slate-200 text-slate-600'}`}>
                        {p.fdr}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-xs text-slate-500">{p.xpts != null ? parseFloat(p.xpts).toFixed(2) : '-'}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-xl font-black text-sky-600">{p.likely_pts ?? '-'}</span>
                      <span className="text-xs text-slate-500 ml-1">pts</span>
                      <p className="text-[10px] text-slate-400 mt-0.5">ceil {p.max_pts ?? '-'}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        to={`/players/${p.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg text-white font-bold bg-gradient-to-r from-[#0a84ff] to-[#00c4ff] shadow-[0_8px_14px_rgba(10,132,255,0.22)] hover:brightness-105 transition-all"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

