import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POS_COLOR = {
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-emerald-100 text-emerald-700',
  3: 'bg-sky-100 text-sky-700',
  4: 'bg-rose-100 text-rose-700',
};
const FDR_PILL = {
  1: 'bg-emerald-500 text-white',
  2: 'bg-emerald-400 text-white',
  3: 'bg-amber-400 text-white',
  4: 'bg-red-400 text-white',
  5: 'bg-red-600 text-white',
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub, right }) {
  return (
    <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
      <div>
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-3xl font-black tracking-tight ${accent || 'text-gray-900'}`}>{value ?? '...'}</p>
      {sub && <p className="text-xs text-gray-400 mt-1.5 leading-snug">{sub}</p>}
    </Card>
  );
}

function BarRow({ label, value, max, badgeClass, valueSuffix = '' }) {
  const numericValue = toNum(value, 0);
  const pct = max > 0 ? Math.max((numericValue / max) * 100, 2) : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-gray-600 font-medium truncate w-28 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className="h-1.5 rounded-full bg-[#37003c] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md min-w-[2.5rem] text-center ${badgeClass || 'bg-gray-100 text-gray-600'}`}>
        {typeof value === 'number' ? `${value.toFixed(1)}${valueSuffix}` : value}
      </span>
    </div>
  );
}

function PosBadge({ pos }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${POS_COLOR[pos] || 'bg-gray-100 text-gray-500'}`}>
      {POS_LABEL[pos] || pos}
    </span>
  );
}

function FDRBadge({ fdr }) {
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-black ${FDR_PILL[fdr] || 'bg-gray-200 text-gray-500'}`}>
      {fdr}
    </span>
  );
}

function Skeleton({ rows = 6 }) {
  return (
    <div className="space-y-2 p-5">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

function getLinePoints(values, width, height, pad = 14) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const xStep = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const yRange = max - min || 1;

  return values
    .map((value, idx) => {
      const x = pad + (idx * xStep);
      const y = height - pad - (((value - min) / yRange) * (height - pad * 2));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function Sparkline({ values, color = '#37003c' }) {
  if (!values || values.length < 2) {
    return <div className="h-10 w-full bg-gray-50 rounded" />;
  }

  const points = getLinePoints(values, 150, 40, 5);
  return (
    <svg width="150" height="40" viewBox="0 0 150 40" className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrendChart({ trend }) {
  if (!trend.length) {
    return <p className="text-xs text-gray-400 text-center py-8">No historical GW data yet</p>;
  }

  const values = trend.map(t => toNum(t.avg_points, 0));
  const points = getLinePoints(values, 620, 220, 18);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const labels = trend.map(t => `GW${t.gameweek}`);

  return (
    <div className="space-y-3">
      <div className="px-5 pt-4">
        <svg viewBox="0 0 620 220" className="w-full h-52 bg-slate-50 rounded-xl border border-gray-100">
          {[0, 1, 2, 3].map(i => {
            const y = 18 + (i * (220 - 36) / 3);
            return <line key={i} x1="18" y1={y} x2="602" y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          <polyline points={points} fill="none" stroke="#37003c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((value, idx) => {
            const xStep = values.length > 1 ? (620 - 36) / (values.length - 1) : 0;
            const x = 18 + (idx * xStep);
            const yRange = max - min || 1;
            const y = 220 - 18 - (((value - min) / yRange) * (220 - 36));
            return <circle key={idx} cx={x} cy={y} r="3.6" fill="#00b37a" />;
          })}
        </svg>
      </div>
      <div className="px-5 pb-4">
        <div className="grid grid-cols-6 md:grid-cols-12 gap-1 text-[10px] text-gray-400">
          {labels.map((label, idx) => (
            <span key={idx} className="text-center">{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function XptsLeaders({ players }) {
  const top = players.slice(0, 8);
  const max = top.length ? Math.max(...top.map(p => toNum(p.xpts, 0))) : 1;
  return (
    <Card>
      <CardHeader title="xPts Leaders" sub="Highest expected points this GW" />
      <div className="px-5 py-3 space-y-2">
        {top.map(p => (
          <BarRow key={p.id} label={p.name} value={toNum(p.xpts, 0)} max={max} badgeClass={POS_COLOR[p.position]} />
        ))}
      </div>
    </Card>
  );
}

function FormLeaders({ players }) {
  const top = [...players].sort((a, b) => toNum(b.form, 0) - toNum(a.form, 0)).slice(0, 8);
  const max = top.length ? Math.max(...top.map(p => toNum(p.form, 0))) : 1;
  return (
    <Card>
      <CardHeader title="Form Leaders" sub="Highest FPL form score" />
      <div className="px-5 py-3 space-y-2">
        {top.map(p => (
          <BarRow key={p.id} label={p.name} value={toNum(p.form, 0)} max={max} badgeClass={POS_COLOR[p.position]} />
        ))}
      </div>
    </Card>
  );
}

function GoalProbabilityPicks({ players }) {
  const top = [...players]
    .filter(p => toNum(p.xg_prob, 0) > 0)
    .sort((a, b) => toNum(b.xg_prob, 0) - toNum(a.xg_prob, 0))
    .slice(0, 8);

  const max = top.length ? Math.max(...top.map(p => toNum(p.xg_prob, 0) * 100)) : 1;
  return (
    <Card>
      <CardHeader title="Goal Probability" sub="Most likely scorers this gameweek" />
      <div className="px-5 py-3 space-y-2">
        {top.map(p => (
          <BarRow
            key={p.id}
            label={p.name}
            value={toNum(p.xg_prob, 0) * 100}
            max={max}
            badgeClass={POS_COLOR[p.position]}
            valueSuffix="%"
          />
        ))}
      </div>
    </Card>
  );
}

function CaptainPicks({ captains, loading }) {
  return (
    <Card>
      <CardHeader title="Captain Picks" sub="Top 5 armband candidates" />
      {loading ? (
        <Skeleton rows={5} />
      ) : captains.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No data, sync first</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {captains.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
              <span className="text-sm font-black text-gray-300 w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PosBadge pos={p.position} />
                  <span className="text-xs text-gray-400">{p.team}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-black text-[#37003c]">
                  {p.likely_pts}
                  <span className="text-xs text-gray-400 font-normal ml-0.5">pts</span>
                </p>
                <div className="flex items-center gap-1 justify-end mt-0.5">
                  <FDRBadge fdr={p.fdr} />
                  <span className="text-xs text-gray-400">{toNum(p.xpts, 0).toFixed(1)} xPts</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TransferTargets({ transfers, loading }) {
  const [filter, setFilter] = useState('ALL');
  const filterMap = { ALL: null, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
  const transferRows = Array.isArray(transfers?.data) ? transfers.data : [];
  const bestByPosition = Array.isArray(transfers?.best_by_position) ? transfers.best_by_position : [];

  const selectedPos = filterMap[filter];
  const filteredRows = selectedPos
    ? transferRows.filter(t => t.position === selectedPos)
    : transferRows;
  const targets = filteredRows.slice(0, 5);

  const filters = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'];
  return (
    <Card>
      <CardHeader
        title="Transfer Targets"
        sub="Top 5 unique swaps over the next 3 GWs"
        right={(
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {filters.map(key => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-[11px] font-bold px-2 py-1 rounded-md transition-colors ${
                  filter === key
                    ? 'bg-[#37003c] text-[#00ff85]'
                    : 'text-gray-500 hover:bg-white'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        )}
      />
      {loading ? (
        <Skeleton rows={7} />
      ) : transferRows.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No data, sync first</p>
      ) : (
        <>
          {bestByPosition.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100 bg-slate-50/70">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Best 3GW Gain By Position</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {bestByPosition.map((b) => (
                  <div key={`best-${b.position}-${b.in.id}`} className="flex items-center justify-between bg-white rounded-lg border border-gray-100 px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <PosBadge pos={b.position} />
                        <p className="text-xs font-semibold text-gray-800 truncate">{b.in.name}</p>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">{b.in.team}</p>
                    </div>
                    <span className="text-xs font-black text-emerald-600">+{toNum(b.gain, 0).toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {targets.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">No {filter} suggestions</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {targets.map((t) => (
                <div key={`${t.in.id}-${t.out.id}`} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PosBadge pos={t.position} />
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{t.in.name}</p>
                        <p className="text-xs text-gray-400">{t.in.team} | {toNum(t.in.price, 0).toFixed(1)}m</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-emerald-600">+{toNum(t.gain, 0).toFixed(1)}</span>
                      <p className="text-xs text-gray-400">xPts gain</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-400">
                    <span>OUT:</span>
                    <span className="line-through text-gray-400">{t.out.name}</span>
                    <span>({t.out.xpts} xPts)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function BestByPosition({ players }) {
  const byPos = { 1: null, 2: null, 3: null, 4: null };
  for (const p of players) {
    if (!byPos[p.position] || toNum(p.xpts, 0) > toNum(byPos[p.position].xpts, 0)) {
      byPos[p.position] = p;
    }
  }
  const posNames = { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' };
  return (
    <Card>
      <CardHeader title="Best by Position" sub="Top predicted player per role" />
      <div className="divide-y divide-gray-50">
        {[1, 2, 3, 4].map(pos => {
          const p = byPos[pos];
          return (
            <div key={pos} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg w-10 text-center ${POS_COLOR[pos]}`}>
                {POS_LABEL[pos]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{p?.name ?? '-'}</p>
                <p className="text-xs text-gray-400">{p?.team ?? posNames[pos]}</p>
              </div>
              {p && (
                <div className="text-right shrink-0">
                  <span className="text-lg font-black text-[#37003c]">{p.likely_pts}</span>
                  <span className="text-xs text-gray-400 ml-1">pts</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function UpcomingFixtures({ fixtures, loading }) {
  const { current = [], next = [], currentGW, nextGW } = fixtures;
  return (
    <Card>
      <CardHeader
        title="Upcoming Fixtures"
        sub="Current and next gameweek"
        right={(
          <div className="flex gap-1">
            {currentGW && <span className="text-xs bg-[#37003c] text-[#00ff85] px-2 py-0.5 rounded-md font-bold">GW{currentGW}</span>}
            {nextGW && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md font-bold">GW{nextGW}</span>}
          </div>
        )}
      />
      {loading ? (
        <Skeleton rows={6} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-gray-100">
          {[{ gw: currentGW, list: current }, { gw: nextGW, list: next }].map(({ gw, list }, idx) => (
            <div key={gw != null ? `gw-${gw}` : `slot-${idx}`} className="py-2">
              {list.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No fixtures</p>
              ) : list.map(f => (
                <div key={f.id} className="flex items-center justify-between px-4 py-1.5 hover:bg-slate-50 text-xs">
                  <div className="flex items-center gap-1.5 w-20 justify-end">
                    <span className="font-semibold text-gray-700">{f.home_short}</span>
                    <FDRBadge fdr={f.difficulty_home} />
                  </div>
                  <div className="text-center w-12">
                    {f.finished ? (
                      <span className="font-black text-gray-800">{f.score_home}-{f.score_away}</span>
                    ) : (
                      <span className="text-gray-400 font-bold tracking-widest">vs</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 w-20">
                    <FDRBadge fdr={f.difficulty_away} />
                    <span className="font-semibold text-gray-700">{f.away_short}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FixtureProbabilitiesPanel({ gameweek, fixtures, loading }) {
  const formatPct = (v) => `${(toNum(v, 0) * 100).toFixed(1)}%`;
  const formatKickoff = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Card>
      <CardHeader
        title={`GW${gameweek || '-'} Fixture Win Probabilities`}
        sub="Win/draw chance and likely scorers for every fixture"
      />
      {loading ? (
        <Skeleton rows={10} />
      ) : fixtures.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No fixture probability data yet</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {fixtures.map((f) => {
            const homeWin = toNum(f?.probabilities?.home_win, 0);
            const draw = toNum(f?.probabilities?.draw, 0);
            const awayWin = toNum(f?.probabilities?.away_win, 0);
            const best =
              homeWin >= draw && homeWin >= awayWin
                ? `${f.home_short} win`
                : awayWin >= draw
                  ? `${f.away_short} win`
                  : 'Draw';

            return (
              <div key={f.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">
                      {f.home_short} vs {f.away_short}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatKickoff(f.kickoff_time)}
                      {f?.likely_scoreline ? ` | likely score ${f.likely_scoreline.home}-${f.likely_scoreline.away}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs bg-[#37003c] text-[#00ff85] px-2 py-1 rounded-md font-bold">
                      {best}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1">
                      xG {toNum(f?.expected_goals?.home, 0).toFixed(2)} - {toNum(f?.expected_goals?.away, 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 h-2 rounded-full overflow-hidden bg-gray-100 flex">
                  <div className="bg-emerald-500" style={{ width: `${Math.max(homeWin * 100, 1)}%` }} />
                  <div className="bg-amber-400" style={{ width: `${Math.max(draw * 100, 1)}%` }} />
                  <div className="bg-rose-500" style={{ width: `${Math.max(awayWin * 100, 1)}%` }} />
                </div>

                <div className="grid grid-cols-3 gap-2 mt-1.5 text-[11px] text-gray-500">
                  <span>{f.home_short} {formatPct(homeWin)}</span>
                  <span className="text-center">Draw {formatPct(draw)}</span>
                  <span className="text-right">{f.away_short} {formatPct(awayWin)}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                  <div className="bg-slate-50 border border-gray-100 rounded-lg px-2.5 py-2">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Likely scorers {f.home_short}</p>
                    <p className="text-xs text-gray-700 mt-1 truncate">
                      {(f?.likely_scorers?.home || []).length
                        ? (f.likely_scorers.home || [])
                          .map(s => `${s.name} (${formatPct(s.goal_probability)})`)
                          .join(' | ')
                        : 'No scorer signal'}
                    </p>
                  </div>
                  <div className="bg-slate-50 border border-gray-100 rounded-lg px-2.5 py-2">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Likely scorers {f.away_short}</p>
                    <p className="text-xs text-gray-700 mt-1 truncate">
                      {(f?.likely_scorers?.away || []).length
                        ? (f.likely_scorers.away || [])
                          .map(s => `${s.name} (${formatPct(s.goal_probability)})`)
                          .join(' | ')
                        : 'No scorer signal'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CleanSheetPicks({ players }) {
  const top = [...players]
    .filter(p => p.position <= 2 && toNum(p.cs_prob, 0) > 0)
    .sort((a, b) => toNum(b.cs_prob, 0) - toNum(a.cs_prob, 0))
    .slice(0, 8);

  return (
    <Card>
      <CardHeader title="Clean Sheet Picks" sub="GKP and DEF with best CS probability" />
      <div className="px-5 py-3 space-y-2">
        {top.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No data, sync first</p>
        ) : top.map(p => (
          <BarRow
            key={p.id}
            label={p.name}
            value={Math.round(toNum(p.cs_prob, 0) * 100)}
            max={100}
            badgeClass={POS_COLOR[p.position]}
          />
        ))}
      </div>
    </Card>
  );
}

function PredictionHistoryPanel({ players, loading }) {
  return (
    <Card>
      <CardHeader title="Past GW Points vs Next xPts" sub="Top predicted players with recent gameweek trend" />
      {loading ? (
        <Skeleton rows={8} />
      ) : players.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No historical data, sync first</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {players.map((p) => (
            <div key={p.id} className="px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.team} | last3 {toNum(p.avg_last3, 0).toFixed(1)} pts</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-[#37003c]">{toNum(p.xpts, 0).toFixed(1)}</p>
                  <p className="text-[11px] text-gray-400">next xPts</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Sparkline values={p.history_points || []} color="#0f766e" />
                <span className={`text-xs font-bold px-2 py-1 rounded ${toNum(p.momentum, 0) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {toNum(p.momentum, 0) >= 0 ? '+' : ''}{toNum(p.momentum, 0).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function HistoryHeatmapPanel({ players, loading }) {
  const { gwLabels, rows, maxPoints } = useMemo(() => {
    const labels = Array.from(
      new Set(players.flatMap(p => (p.history || []).map(h => h.gameweek)))
    ).sort((a, b) => a - b);

    const mapped = players.map(p => {
      const map = {};
      (p.history || []).forEach(h => { map[h.gameweek] = toNum(h.points, 0); });
      return {
        id: p.id,
        name: p.name,
        values: labels.map(gw => map[gw] ?? null),
      };
    });

    const max = Math.max(1, ...mapped.flatMap(r => r.values).filter(v => v != null));
    return { gwLabels: labels, rows: mapped, maxPoints: max };
  }, [players]);

  const cellStyle = (value) => {
    if (value == null) return { backgroundColor: '#f8fafc', color: '#94a3b8' };
    const ratio = Math.min(value / maxPoints, 1);
    const alpha = 0.12 + (ratio * 0.72);
    const color = ratio > 0.55 ? '#ffffff' : '#1f2937';
    return { backgroundColor: `rgba(55,0,60,${alpha.toFixed(3)})`, color };
  };

  return (
    <Card>
      <CardHeader title="Past GW Points Heatmap" sub="Historical FPL points per gameweek for top predicted players" />
      {loading ? (
        <Skeleton rows={8} />
      ) : rows.length === 0 || gwLabels.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No gameweek history available</p>
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="text-left px-2 py-2 text-gray-400 font-semibold">Player</th>
                {gwLabels.map(gw => (
                  <th key={gw} className="text-center px-1.5 py-2 text-gray-400 font-semibold">GW{gw}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="px-2 py-2 font-semibold text-gray-700 whitespace-nowrap">{row.name}</td>
                  {row.values.map((value, idx) => (
                    <td key={`${row.id}-${idx}`} className="px-1.5 py-2">
                      <div className="w-9 h-7 rounded-md flex items-center justify-center font-bold" style={cellStyle(value)}>
                        {value == null ? '-' : value}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MomentumPanel({ rows, loading }) {
  return (
    <Card>
      <CardHeader title="Momentum Picks" sub="Improving players from recent gameweeks" />
      {loading ? (
        <Skeleton rows={6} />
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No momentum data yet</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-xs text-gray-400">{p.team} | last3 {toNum(p.avg_last3, 0).toFixed(1)} vs last6 {toNum(p.avg_last6, 0).toFixed(1)}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-sm font-black ${toNum(p.momentum, 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {toNum(p.momentum, 0) >= 0 ? '+' : ''}{toNum(p.momentum, 0).toFixed(2)}
                </span>
                <p className="text-[11px] text-gray-400">trend</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const [players, setPlayers] = useState([]);
  const [captains, setCaptains] = useState([]);
  const [transfers, setTransfers] = useState({
    data: [],
    best_by_position: [],
    gameweeks: [],
  });
  const [fixtures, setFixtures] = useState({});
  const [fixtureProbabilities, setFixtureProbabilities] = useState([]);
  const [insights, setInsights] = useState({ trend: [], players: [], momentum: [] });

  const [loading, setLoading] = useState(true);
  const [captainLoading, setCaptainLoading] = useState(true);
  const [transferLoading, setTransferLoading] = useState(true);
  const [fixtureLoading, setFixtureLoading] = useState(true);
  const [fixtureProbLoading, setFixtureProbLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [gameweek, setGameweek] = useState(null);
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setError(null);
      setLoading(true);
      setCaptainLoading(true);
      setTransferLoading(true);
      setFixtureLoading(true);
      setFixtureProbLoading(true);
      setInsightsLoading(true);

      try {
        const playersRes = await axios.get('/api/players');
        if (!active) return;

        const gw = playersRes.data.gameweek;
        setPlayers(playersRes.data.data || []);
        setGameweek(gw);
        setLoading(false);

        const [captainRes, transferRes, fixtureRes, fixtureProbRes, insightsRes] = await Promise.allSettled([
          axios.get(`/api/predictions/captain?gw=${gw}`),
          axios.get('/api/predictions/transfers'),
          axios.get('/api/fixtures/upcoming'),
          axios.get(`/api/fixtures/probabilities?gw=${gw}`),
          axios.get(`/api/predictions/insights?gw=${gw}`),
        ]);

        if (!active) return;

        if (captainRes.status === 'fulfilled') {
          setCaptains(captainRes.value.data.data || []);
        } else {
          setCaptains([]);
        }
        setCaptainLoading(false);

        if (transferRes.status === 'fulfilled') {
          const payload = transferRes.value.data || {};
          setTransfers({
            data: Array.isArray(payload.data) ? payload.data : [],
            best_by_position: Array.isArray(payload.best_by_position) ? payload.best_by_position : [],
            gameweeks: Array.isArray(payload.gameweeks) ? payload.gameweeks : [],
          });
        } else {
          setTransfers({ data: [], best_by_position: [], gameweeks: [] });
        }
        setTransferLoading(false);

        if (fixtureRes.status === 'fulfilled') {
          setFixtures(fixtureRes.value.data || {});
        } else {
          setFixtures({});
        }
        setFixtureLoading(false);

        if (fixtureProbRes.status === 'fulfilled') {
          setFixtureProbabilities(fixtureProbRes.value.data.data || []);
        } else {
          setFixtureProbabilities([]);
        }
        setFixtureProbLoading(false);

        if (insightsRes.status === 'fulfilled') {
          setInsights({
            trend: insightsRes.value.data.trend || [],
            players: insightsRes.value.data.players || [],
            momentum: insightsRes.value.data.momentum || [],
          });
        } else {
          setInsights({ trend: [], players: [], momentum: [] });
        }
        setInsightsLoading(false);
      } catch {
        if (!active) return;
        setError('Could not load data. Is the server running?');
        setLoading(false);
        setCaptainLoading(false);
        setTransferLoading(false);
        setFixtureLoading(false);
        setFixtureProbLoading(false);
        setInsightsLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [syncTick]);

  const syncData = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/sync');
      setSyncTick(t => t + 1);
    } catch (e) {
      setError(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-900">
            {gameweek ? `GW${gameweek} Overview` : 'FPL Overview'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {gameweek
              ? `Predictions, historical trends, and transfer signals for GW ${gameweek}`
              : 'Sync FPL data to load analytics'}
          </p>
        </div>
        <button
          onClick={syncData}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#37003c] text-[#00ff85] text-sm font-bold rounded-xl disabled:opacity-50 hover:opacity-90 transition-opacity shadow-sm"
        >
          <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {syncing ? 'Syncing...' : 'Sync FPL Data'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <FixtureProbabilitiesPanel
        gameweek={gameweek}
        fixtures={fixtureProbabilities}
        loading={fixtureProbLoading}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {loading ? (
          <>
            <Card><CardHeader title="xPts Leaders" /><Skeleton /></Card>
            <Card><CardHeader title="Form Leaders" /><Skeleton /></Card>
            <Card><CardHeader title="Goal Probability" /><Skeleton /></Card>
          </>
        ) : (
          <>
            <XptsLeaders players={players} />
            <FormLeaders players={players} />
            <GoalProbabilityPicks players={players} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <CaptainPicks captains={captains} loading={captainLoading} />
        <TransferTargets transfers={transfers} loading={transferLoading} />
        {loading
          ? <Card><CardHeader title="Best by Position" /><Skeleton rows={4} /></Card>
          : <BestByPosition players={players} />
        }
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <UpcomingFixtures fixtures={fixtures} loading={fixtureLoading} />
        {loading
          ? <Card><CardHeader title="Clean Sheet Picks" /><Skeleton /></Card>
          : <CleanSheetPicks players={players} />
        }
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Gameweek Trend Chart" sub="Average historical FPL points across tracked players" />
          {insightsLoading ? <Skeleton rows={8} /> : <TrendChart trend={insights.trend || []} />}
        </Card>
        <MomentumPanel rows={insights.momentum || []} loading={insightsLoading} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <PredictionHistoryPanel players={insights.players || []} loading={insightsLoading} />
        <HistoryHeatmapPanel players={insights.players || []} loading={insightsLoading} />
      </div>
    </div>
  );
}
