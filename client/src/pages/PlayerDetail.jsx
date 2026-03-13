import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import Heatmap from '../components/Heatmap';

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

function StatBox({ label, value, sub }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 text-center">
      <div className="text-2xl font-black text-gray-900">{value ?? '—'}</div>
      <div className="text-xs font-medium text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-300 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PlayerDetail() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/players/${id}`)
      .then(res => setPlayer(res.data.data))
      .catch(() => setError('Could not load player data.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="space-y-5">
      <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
      <div className="h-32 bg-white rounded-2xl border border-gray-100 animate-pulse" />
      <div className="grid grid-cols-2 gap-5">
        <div className="h-64 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        <div className="h-64 bg-white rounded-2xl border border-gray-100 animate-pulse" />
      </div>
    </div>
  );

  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">⚠ {error}</div>
  );
  if (!player) return null;

  const hasFotmob = player.xg_total != null || player.season_rating != null;
  const touches   = player.heatmap_touches || [];
  const matches   = player.recent_matches  || [];
  const preds     = player.predictions     || [];
  const initials  = player.name.split(' ').map(n => n[0]).slice(0, 2).join('');

  return (
    <div className="space-y-5">

      {/* Back */}
      <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Players
      </Link>

      {/* Player header card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-wrap items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-[#37003c] flex items-center justify-center text-[#00ff85] text-xl font-black flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black text-gray-900 truncate">{player.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={`text-xs px-2.5 py-1 rounded-lg font-bold ${POS_COLOR[player.position]}`}>
              {POS_LABEL[player.position]}
            </span>
            <span className="text-sm text-gray-600 font-medium">{player.team_name}</span>
            <span className="text-sm text-gray-400">£{parseFloat(player.price).toFixed(1)}m</span>
            <span className="text-sm text-gray-400">{player.selected_by_percent}% selected</span>
          </div>
        </div>
        {player.season_rating && (
          <div className="bg-[#37003c] rounded-2xl px-5 py-3 text-center">
            <div className="text-3xl font-black text-[#00ff85]">{parseFloat(player.season_rating).toFixed(1)}</div>
            <div className="text-xs text-gray-400 mt-0.5">FotMob rating</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left col */}
        <div className="space-y-5">

          {/* Season stats */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Season Stats</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Goals"   value={player.goals_scored} />
              <StatBox label="Assists" value={player.assists} />
              <StatBox label="CS"      value={player.clean_sheets} />
              <StatBox label="xG" value={player.xg_total != null ? parseFloat(player.xg_total).toFixed(2) : '—'} sub="season" />
              <StatBox label="xA" value={player.xa_total != null ? parseFloat(player.xa_total).toFixed(2) : '—'} sub="season" />
              <StatBox label="xGOT" value={player.xgot_total != null ? parseFloat(player.xgot_total).toFixed(2) : '—'} sub="season" />
              <StatBox label="Minutes" value={player.minutes} />
              <StatBox label="Form"    value={parseFloat(player.form).toFixed(1)} />
              <StatBox label="Total"   value={player.total_points} sub="pts" />
            </div>
            {!hasFotmob && (
              <p className="text-xs text-gray-400 text-center mt-3">FotMob data appears after next sync</p>
            )}
          </div>

          {/* GW Predictions */}
          {preds.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">GW Predictions</h2>
              <div className="space-y-2">
                {preds.map(pr => (
                  <div key={pr.gameweek} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                    <span className="text-sm font-bold text-gray-700">GW{pr.gameweek}</span>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${FDR_PILL[pr.fdr] || 'bg-gray-200'}`}>{pr.fdr}</span>
                      <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-md">{pr.min_pts}–{pr.max_pts}</span>
                      <span className="text-xs text-gray-400">{pr.xpts} xPts</span>
                      <span className="text-xl font-black text-[#37003c]">{pr.likely_pts}</span>
                      <span className="text-xs text-gray-400">pts</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right col */}
        <div className="space-y-5">

          {/* Heatmap */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Touch Heatmap</h2>
              {touches.length > 0 && <span className="text-xs text-gray-400 bg-slate-50 px-2 py-1 rounded-lg">{touches.length} touches</span>}
            </div>
            {touches.length > 0 ? (
              <Heatmap touches={touches} width={420} height={280} />
            ) : (
              <div className="h-44 flex items-center justify-center bg-[#1a6b3c] rounded-xl">
                <p className="text-white text-xs opacity-50">Heatmap data loads after FotMob sync</p>
              </div>
            )}
          </div>

          {/* Recent matches */}
          {matches.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Recent Matches</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-5 py-2.5 text-gray-400 font-semibold">Vs</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">Min</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">G</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">A</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">xG</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">xA</th>
                      <th className="text-center px-3 text-gray-400 font-semibold">xGOT</th>
                      <th className="text-right px-5 text-gray-400 font-semibold">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {matches.map((m, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-5 py-2.5 text-gray-600 font-medium">{m.opponentName || `ID ${m.opponentId}`}</td>
                        <td className="text-center px-3 text-gray-500">{m.minutes ?? '—'}</td>
                        <td className="text-center px-3 font-bold text-gray-800">{m.goals ?? '—'}</td>
                        <td className="text-center px-3 font-bold text-gray-800">{m.assists ?? '—'}</td>
                        <td className="text-center px-3 text-gray-500">{m.xg?.toFixed(2) ?? '—'}</td>
                        <td className="text-center px-3 text-gray-500">{m.xa?.toFixed(2) ?? '—'}</td>
                        <td className="text-center px-3 text-gray-500">{m.xgot?.toFixed(2) ?? '—'}</td>
                        <td className="text-right px-5">
                          {m.rating ? (
                            <span className={`font-black ${m.rating >= 8 ? 'text-emerald-600' : m.rating >= 6.5 ? 'text-amber-600' : 'text-red-500'}`}>
                              {m.rating.toFixed(1)}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
