import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POS_COLOR = {
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-emerald-100 text-emerald-700',
  3: 'bg-sky-100 text-sky-700',
  4: 'bg-rose-100 text-rose-700',
};
const FDR_PILL = {
  1:'bg-emerald-500 text-white', 2:'bg-emerald-400 text-white',
  3:'bg-amber-400 text-white',  4:'bg-red-400 text-white', 5:'bg-red-600 text-white',
};
const POSITIONS = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'];

export default function Players() {
  const [players, setPlayers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [posFilter, setPosFilter] = useState('ALL');
  const [gameweek, setGameweek]   = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = posFilter !== 'ALL' ? { pos: posFilter } : {};
    axios.get('/api/players', { params })
      .then(res => { setPlayers(res.data.data || []); setGameweek(res.data.gameweek); })
      .catch(() => setError('Could not load players. Is the server running?'))
      .finally(() => setLoading(false));
  }, [posFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Players</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Click <strong>View</strong> for stats, heatmap and recent matches
            {gameweek && ` · GW${gameweek} predictions`}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">⚠ {error}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Table header + filter */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">All Players</h2>
            <p className="text-xs text-gray-400">Top 50 by total points</p>
          </div>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {POSITIONS.map(pos => (
              <button key={pos} onClick={() => setPosFilter(pos)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  posFilter === pos ? 'bg-[#37003c] text-[#00ff85] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">#</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Player</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Pos</th>
                <th className="text-right px-5 py-3 text-xs text-gray-400 font-semibold">Price</th>
                <th className="text-right px-5 py-3 text-xs text-gray-400 font-semibold">Form</th>
                <th className="text-center px-5 py-3 text-xs text-gray-400 font-semibold">FDR</th>
                <th className="text-right px-5 py-3 text-xs text-gray-400 font-semibold">xPts</th>
                <th className="text-right px-5 py-3 text-xs text-gray-400 font-semibold">Predicted</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(9)].map((_, j) => (
                      <td key={j} className="px-5 py-3"><div className="h-3 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : players.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-gray-400 text-sm">
                  No data — sync FPL data from the Dashboard first.
                </td></tr>
              ) : (
                players.map((p, i) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-xs text-gray-400 font-medium">{i + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.team}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-semibold ${POS_COLOR[p.position]}`}>
                        {POS_LABEL[p.position]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-gray-600">£{parseFloat(p.price).toFixed(1)}m</td>
                    <td className="px-5 py-3.5 text-right text-sm text-gray-600">{parseFloat(p.form).toFixed(1)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${FDR_PILL[p.fdr] || 'bg-gray-200 text-gray-600'}`}>
                        {p.fdr}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-xs text-gray-400">{p.xpts ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-xl font-black text-[#37003c]">{p.likely_pts ?? '—'}</span>
                      <span className="text-xs text-gray-400 ml-1">pts</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link to={`/players/${p.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[#37003c] text-[#00ff85] font-bold hover:opacity-80 transition-opacity">
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
