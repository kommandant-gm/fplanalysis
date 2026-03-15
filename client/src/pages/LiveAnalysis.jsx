import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Heatmap from '../components/Heatmap';

const POLL_INTERVAL = 30_000; // 30s when live

// ─── Helpers ────────────────────────────────────────────────────────────────

function TeamLogo({ id, name, size = 28, logo }) {
  const src = logo || (id ? `https://images.fotmob.com/image_resources/logo/teamlogo/${id}_xsmall.png` : null);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="object-contain"
      onError={e => { e.target.style.display = 'none'; }}
    />
  );
}

function fmt(val, decimals = 2) {
  if (val == null || !Number.isFinite(Number(val))) return '—';
  return Number(val).toFixed(decimals);
}

// ─── Match card (selector) ───────────────────────────────────────────────────

function StatusPip({ status, minute }) {
  if (status === 'inProgress') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {minute || 'LIVE'}
      </span>
    );
  }
  if (status === 'finished') {
    return <span className="text-[10px] font-semibold text-slate-400">FT</span>;
  }
  return <span className="text-[10px] font-semibold text-slate-400">NS</span>;
}

function MatchCard({ match, selected, onClick }) {
  const isLive = match.status === 'inProgress';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left futura-panel p-3 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
        selected ? 'ring-2 ring-[#0a84ff] shadow-[0_0_0_2px_rgba(10,132,255,0.15)]' : ''
      } ${isLive ? 'border-emerald-300' : ''}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <StatusPip status={match.status} minute={match.minute} />
        {match.kickoff && match.status === 'notStarted' && (
          <span className="text-[10px] text-slate-400">
            {new Date(match.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <TeamLogo id={match.homeTeam.id} name={match.homeTeam.name} size={22} />
          <span className="text-xs font-bold text-slate-800 truncate">{match.homeTeam.shortName || match.homeTeam.name}</span>
        </div>
        <span className="text-sm font-black text-slate-900 tabular-nums shrink-0">
          {match.score.home ?? '—'} – {match.score.away ?? '—'}
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="text-xs font-bold text-slate-800 truncate">{match.awayTeam.shortName || match.awayTeam.name}</span>
          <TeamLogo id={match.awayTeam.id} name={match.awayTeam.name} size={22} />
        </div>
      </div>
    </button>
  );
}

// ─── Score header ────────────────────────────────────────────────────────────

function ScoreHeader({ data }) {
  const { homeTeam, awayTeam, status, minute } = data;
  return (
    <div className="futura-panel p-5 mb-4">
      <div className="flex items-center justify-center gap-4 sm:gap-8">
        <div className="flex-1 flex flex-col items-end gap-2">
          <TeamLogo id={homeTeam.id} name={homeTeam.name} size={52} logo={homeTeam.logo} />
          <p className="text-base sm:text-xl font-black text-slate-900 text-right">{homeTeam.name}</p>
          <p className="text-[11px] text-slate-400 font-medium">Home</p>
        </div>
        <div className="text-center shrink-0">
          <div className="text-3xl sm:text-5xl font-black text-slate-900 tabular-nums leading-none">
            {homeTeam.score ?? '—'} – {awayTeam.score ?? '—'}
          </div>
          <div className="mt-2">
            <StatusPip status={status} minute={minute} />
          </div>
        </div>
        <div className="flex-1 flex flex-col items-start gap-2">
          <TeamLogo id={awayTeam.id} name={awayTeam.name} size={52} logo={awayTeam.logo} />
          <p className="text-base sm:text-xl font-black text-slate-900">{awayTeam.name}</p>
          <p className="text-[11px] text-slate-400 font-medium">Away</p>
        </div>
      </div>
    </div>
  );
}

// ─── Events feed ─────────────────────────────────────────────────────────────

const EVENT_ICON = {
  Goal: '⚽',
  OwnGoal: '⚽',
  Card: { Yellow: '🟨', Red: '🟥', YellowRed: '🟧' },
  Substitution: '🔄',
  Var: '📺',
  MissedPenalty: '❌',
};

function EventRow({ event, homeId }) {
  const isHome = Number(event.teamId) === Number(homeId);
  const type = event.type;
  let icon = '•';
  if (type === 'Goal' || event.isGoal) icon = event.isOwnGoal ? '⚽ OG' : event.isPenalty ? '⚽ P' : '⚽';
  else if (type === 'Card') icon = EVENT_ICON.Card[event.card] || '🟨';
  else if (type === 'Substitution') icon = EVENT_ICON.Substitution;
  else if (type === 'Var') icon = EVENT_ICON.Var;
  else if (type === 'MissedPenalty') icon = EVENT_ICON.MissedPenalty;

  const isGoalEvent = type === 'Goal' || event.isGoal;

  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded-lg ${isGoalEvent ? 'bg-emerald-50 border border-emerald-100' : ''}`}>
      <span className="text-[11px] font-bold text-slate-400 w-8 shrink-0 tabular-nums pt-0.5">
        {event.minute}{event.addedMinute ? `+${event.addedMinute}` : ''}'
      </span>
      <span className="text-sm shrink-0">{icon}</span>
      <div className={`flex-1 min-w-0 ${isHome ? '' : 'text-right'}`}>
        <p className="text-xs font-semibold text-slate-800 truncate">
          {type === 'Substitution'
            ? `↑ ${event.subIn}  ↓ ${event.subOut}`
            : event.playerName}
        </p>
        {event.assistName && (
          <p className="text-[10px] text-slate-400">Assist: {event.assistName}</p>
        )}
        {event.varOutcome && (
          <p className="text-[10px] text-slate-500">VAR: {event.varOutcome}</p>
        )}
      </div>
      <span className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded ${isHome ? 'bg-sky-50 text-sky-600' : 'bg-rose-50 text-rose-600'}`}>
        {isHome ? 'H' : 'A'}
      </span>
    </div>
  );
}

function EventsFeed({ events, homeId }) {
  const reversed = [...events].reverse();
  return (
    <div className="futura-panel p-4 h-full">
      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Match Events</h3>
      {!events.length
        ? <p className="text-xs text-slate-400 text-center py-6">No events yet</p>
        : <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
            {reversed.map((e, i) => (
              <EventRow key={i} event={e} homeId={homeId} />
            ))}
          </div>
      }
    </div>
  );
}

// ─── Stat bar (side-by-side comparison) ──────────────────────────────────────

function StatBar({ label, home, away, isPercent }) {
  const h = Number(home) || 0;
  const a = Number(away) || 0;
  const total = h + a;
  const homePct = total > 0 ? (h / total) * 100 : 50;
  const awayPct = 100 - homePct;

  return (
    <div className="mb-3">
      <div className="flex justify-between text-[11px] font-bold mb-1">
        <span className="text-sky-600">{isPercent ? `${h}%` : h}</span>
        <span className="text-slate-500 font-medium capitalize">{label}</span>
        <span className="text-rose-500">{isPercent ? `${a}%` : a}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden">
        <div
          className="bg-gradient-to-r from-[#0a84ff] to-[#00c4ff] rounded-l-full transition-all duration-500"
          style={{ width: `${homePct}%` }}
        />
        <div
          className="bg-gradient-to-l from-rose-500 to-rose-400 rounded-r-full transition-all duration-500"
          style={{ width: `${awayPct}%` }}
        />
      </div>
    </div>
  );
}

const STAT_KEYS = [
  { key: 'possession', label: 'Possession', isPercent: true },
  { key: 'expected goals (xg)', label: 'xG', isPercent: false },
  { key: 'shots', label: 'Shots', isPercent: false },
  { key: 'shots on target', label: 'Shots on Target', isPercent: false },
  { key: 'fouls', label: 'Fouls', isPercent: false },
  { key: 'tackles', label: 'Tackles', isPercent: false },
  { key: 'corners', label: 'Corners', isPercent: false },
  { key: 'yellow cards', label: 'Yellow Cards', isPercent: false },
  { key: 'red cards', label: 'Red Cards', isPercent: false },
  { key: 'offsides', label: 'Offsides', isPercent: false },
  { key: 'passes', label: 'Passes', isPercent: false },
  { key: 'pass accuracy', label: 'Pass Accuracy', isPercent: true },
  { key: 'big chances', label: 'Big Chances', isPercent: false },
  { key: 'saves', label: 'Saves', isPercent: false },
  { key: 'clearances', label: 'Clearances', isPercent: false },
  { key: 'interceptions', label: 'Interceptions', isPercent: false },
  { key: 'aerial duels won', label: 'Aerial Duels Won', isPercent: false },
  { key: 'dribbles', label: 'Dribbles', isPercent: false },
];

function StatsPanel({ stats, homeTeam, awayTeam }) {
  const available = STAT_KEYS.filter(s => stats[s.key] != null);
  return (
    <div className="futura-panel p-4">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
        <span className="text-sky-500">{homeTeam.shortName || homeTeam.name}</span>
        <span>Stats</span>
        <span className="text-rose-400">{awayTeam.shortName || awayTeam.name}</span>
      </div>
      {!available.length
        ? <p className="text-xs text-slate-400 text-center py-4">Stats not yet available</p>
        : available.map(s => (
            <StatBar
              key={s.key}
              label={s.label}
              home={stats[s.key].home}
              away={stats[s.key].away}
              isPercent={s.isPercent || stats[s.key].isPercent}
            />
          ))
      }
    </div>
  );
}

// ─── Momentum SVG chart ───────────────────────────────────────────────────────

function MomentumChart({ momentum, homeTeam, awayTeam }) {
  if (!momentum.length) {
    return (
      <div className="futura-panel p-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Momentum</h3>
        <p className="text-xs text-slate-400 text-center py-4">No momentum data yet</p>
      </div>
    );
  }

  const W = 400, H = 100, MID = 50;
  const maxVal = Math.max(...momentum.map(d => Math.abs(d.value)), 1);
  const maxMin = Math.max(...momentum.map(d => d.minute), 90);

  const toX = min => (min / maxMin) * W;
  const toY = val => MID - (val / maxVal) * (MID - 4);

  return (
    <div className="futura-panel p-4">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-2">
        <span className="text-sky-500">{homeTeam.shortName || homeTeam.name}</span>
        <span className="text-slate-400">Momentum</span>
        <span className="text-rose-400">{awayTeam.shortName || awayTeam.name}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        {/* Centre line */}
        <line x1={0} y1={MID} x2={W} y2={MID} stroke="#e2ecf7" strokeWidth={1} />
        {/* Bars */}
        {momentum.map((d, i) => {
          const x = toX(d.minute);
          const barW = Math.max(2, W / momentum.length - 0.5);
          const isHome = d.value >= 0;
          const y = isHome ? toY(d.value) : MID;
          const h = Math.abs(toY(d.value) - MID);
          return (
            <rect
              key={i}
              x={x - barW / 2}
              y={y}
              width={barW}
              height={Math.max(1, h)}
              fill={isHome ? '#0a84ff' : '#f43f5e'}
              opacity={0.75}
            />
          );
        })}
        {/* 45' line */}
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#c5d8ee" strokeWidth={0.5} strokeDasharray="3 3" />
        <text x={4} y={H - 4} fontSize={8} fill="#94a3b8">0'</text>
        <text x={W / 2 - 6} y={H - 4} fontSize={8} fill="#94a3b8">45'</text>
        <text x={W - 16} y={H - 4} fontSize={8} fill="#94a3b8">90'</text>
      </svg>
    </div>
  );
}

// ─── xG Timeline SVG ─────────────────────────────────────────────────────────

function XgChart({ xgTimeline, homeTeam, awayTeam }) {
  const { home = [], away = [] } = xgTimeline;
  if (!home.length && !away.length) {
    return (
      <div className="futura-panel p-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">xG Timeline</h3>
        <p className="text-xs text-slate-400 text-center py-4">xG data not yet available</p>
      </div>
    );
  }

  const W = 400, H = 100, PAD = 4;
  const maxXg = Math.max(...home.map(d => d.value), ...away.map(d => d.value), 1);
  const maxMin = Math.max(...home.map(d => d.minute), ...away.map(d => d.minute), 90);

  const toX = min => PAD + (min / maxMin) * (W - PAD * 2);
  const toY = val => H - PAD - (val / maxXg) * (H - PAD * 2);

  const pathFrom = (points) => {
    if (!points.length) return '';
    const sorted = [...points].sort((a, b) => a.minute - b.minute);
    return sorted.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.minute)},${toY(d.value)}`).join(' ');
  };

  return (
    <div className="futura-panel p-4">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-2">
        <span className="text-sky-500">{homeTeam.shortName || homeTeam.name}</span>
        <span className="text-slate-400">xG Timeline</span>
        <span className="text-rose-400">{awayTeam.shortName || awayTeam.name}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 90 }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={PAD} y1={toY(maxXg * f)} x2={W - PAD} y2={toY(maxXg * f)}
            stroke="#e2ecf7" strokeWidth={0.5} />
        ))}
        <line x1={W / 2} y1={PAD} x2={W / 2} y2={H - PAD} stroke="#c5d8ee" strokeWidth={0.5} strokeDasharray="3 3" />
        {/* xG lines */}
        {home.length > 0 && (
          <path d={pathFrom(home)} fill="none" stroke="#0a84ff" strokeWidth={2} strokeLinejoin="round" />
        )}
        {away.length > 0 && (
          <path d={pathFrom(away)} fill="none" stroke="#f43f5e" strokeWidth={2} strokeLinejoin="round" />
        )}
        {/* Current xG labels */}
        {home.length > 0 && (
          <text x={toX(home.at(-1).minute) + 4} y={toY(home.at(-1).value) - 2}
            fontSize={8} fill="#0a84ff" fontWeight="700">
            {fmt(home.at(-1).value)}
          </text>
        )}
        {away.length > 0 && (
          <text x={toX(away.at(-1).minute) + 4} y={toY(away.at(-1).value) - 2}
            fontSize={8} fill="#f43f5e" fontWeight="700">
            {fmt(away.at(-1).value)}
          </text>
        )}
        <text x={4} y={H - 2} fontSize={7} fill="#94a3b8">0'</text>
        <text x={W / 2 - 6} y={H - 2} fontSize={7} fill="#94a3b8">45'</text>
        <text x={W - 16} y={H - 2} fontSize={7} fill="#94a3b8">90'</text>
      </svg>
    </div>
  );
}

// ─── Possession bar ───────────────────────────────────────────────────────────

function PossessionBar({ stats, homeTeam, awayTeam }) {
  const poss = stats['possession'];
  if (!poss) return null;
  const h = Number(poss.home) || 50;
  const a = Number(poss.away) || 50;
  return (
    <div className="futura-panel p-4">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
        <span className="text-sky-500">{homeTeam.shortName || homeTeam.name}</span>
        <span>Possession</span>
        <span className="text-rose-400">{awayTeam.shortName || awayTeam.name}</span>
      </div>
      <div className="flex h-6 rounded-xl overflow-hidden shadow-inner">
        <div
          className="bg-gradient-to-r from-[#0a84ff] to-[#00c4ff] flex items-center justify-center text-[11px] font-black text-white transition-all duration-700"
          style={{ width: `${h}%` }}
        >
          {h}%
        </div>
        <div
          className="bg-gradient-to-l from-rose-500 to-rose-400 flex items-center justify-center text-[11px] font-black text-white transition-all duration-700"
          style={{ width: `${a}%` }}
        >
          {a}%
        </div>
      </div>
    </div>
  );
}

// ─── Players table ────────────────────────────────────────────────────────────

const PLAYER_COLS = [
  { key: 'shirt', label: '#', fmt: v => v ?? '—' },
  { key: 'name', label: 'Player', fmt: v => v },
  { key: 'rating', label: 'Rating', fmt: v => v != null ? Number(v).toFixed(1) : '—' },
  { key: 'minutesPlayed', label: 'Mins', fmt: v => v ?? '—' },
  { key: 'goals', label: 'G', fmt: v => v ?? 0 },
  { key: 'assists', label: 'A', fmt: v => v ?? 0 },
  { key: 'xg', label: 'xG', fmt: v => v != null ? Number(v).toFixed(2) : '—' },
  { key: 'xa', label: 'xA', fmt: v => v != null ? Number(v).toFixed(2) : '—' },
  { key: 'shots', label: 'Shots', fmt: v => v ?? '—' },
  { key: 'tackles', label: 'Tkl', fmt: v => v ?? '—' },
  { key: 'foulsCommitted', label: 'Fouls', fmt: v => v ?? '—' },
  { key: 'touches', label: 'Touch', fmt: v => v ?? '—' },
  { key: 'passes', label: 'Pass', fmt: v => v ?? '—' },
];

function PlayersTable({ players, teamName, onSelectPlayer }) {
  const [sort, setSort] = useState({ key: 'rating', dir: -1 });

  const sorted = [...players].sort((a, b) => {
    const av = a[sort.key] ?? -Infinity;
    const bv = b[sort.key] ?? -Infinity;
    return (Number(av) - Number(bv)) * sort.dir;
  });

  const toggle = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }));

  return (
    <div>
      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{teamName}</h4>
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {PLAYER_COLS.map(c => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-600 whitespace-nowrap select-none"
                >
                  {c.label} {sort.key === c.key ? (sort.dir === -1 ? '↓' : '↑') : ''}
                </th>
              ))}
              <th className="px-2 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Map</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.id} className="border-b border-slate-50 hover:bg-sky-50/40 transition-colors">
                {PLAYER_COLS.map(c => (
                  <td key={c.key} className={`px-2 py-1.5 whitespace-nowrap ${c.key === 'name' ? 'font-semibold text-slate-800' : 'text-slate-600'} ${c.key === 'rating' && p.rating >= 8 ? 'text-emerald-600 font-bold' : ''}`}>
                    {c.fmt(p[c.key])}
                    {p.isSub && c.key === 'name' && <span className="ml-1 text-[9px] text-slate-400">(sub)</span>}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  {p.heatmap?.length > 0 ? (
                    <button
                      onClick={() => onSelectPlayer(p)}
                      className="text-[10px] font-semibold text-sky-500 hover:text-sky-700 underline"
                    >
                      View
                    </button>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Player heatmap modal ─────────────────────────────────────────────────────

function HeatmapModal({ player, onClose }) {
  if (!player) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="futura-panel p-5 max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <div>
            <p className="font-black text-slate-900">{player.name}</p>
            <p className="text-xs text-slate-400">Touch heatmap (updates at HT / FT)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
        </div>
        <Heatmap touches={player.heatmap} width={420} height={280} />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {player.xg != null && <div><p className="text-[10px] text-slate-400">xG</p><p className="font-black text-sky-600">{fmt(player.xg)}</p></div>}
          {player.xa != null && <div><p className="text-[10px] text-slate-400">xA</p><p className="font-black text-violet-600">{fmt(player.xa)}</p></div>}
          {player.rating != null && <div><p className="text-[10px] text-slate-400">Rating</p><p className={`font-black ${player.rating >= 8 ? 'text-emerald-600' : 'text-slate-700'}`}>{fmt(player.rating, 1)}</p></div>}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveAnalysis() {
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [matchData, setMatchData] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState(null);

  const [activeSide, setActiveSide] = useState('home');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const pollRef = useRef(null);

  // Load today's matches — pass browser local date so timezone doesn't shift to yesterday
  useEffect(() => {
    const d = new Date();
    const localDate = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('');
    setMatchesLoading(true);
    axios.get('/api/live/matches', { params: { date: localDate } })
      .then(r => setMatches(r.data.matches || []))
      .catch(e => setMatchesError(e.response?.data?.error || 'Could not load matches'))
      .finally(() => setMatchesLoading(false));
  }, []);

  // Fetch selected match details — pass team names so server can look up ESPN event
  const fetchMatch = useCallback((id) => {
    const match = matches.find(m => m.matchId === id);
    const params = match
      ? { home: match.homeTeam.shortName || match.homeTeam.name, away: match.awayTeam.shortName || match.awayTeam.name }
      : {};
    setMatchLoading(true);
    setMatchError(null);
    axios.get(`/api/live/match/${id}`, { params })
      .then(r => setMatchData(r.data.data))
      .catch(e => setMatchError(e.response?.data?.error || 'Could not load match data'))
      .finally(() => setMatchLoading(false));
  }, [matches]);

  // Select match + start polling if live
  const selectMatch = useCallback((id) => {
    setSelectedId(id);
    setMatchData(null);
    setMatchError(null);
    setActiveSide('home');
    if (pollRef.current) clearInterval(pollRef.current);

    const match = matches.find(m => m.matchId === id);
    if (match?.status === 'notStarted') {
      // No live data available yet for upcoming matches
      setMatchError(`Match hasn't started yet — kicks off at ${match.kickoff ? new Date(match.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'scheduled time'}`);
      return;
    }

    fetchMatch(id);
    if (match?.status === 'inProgress') {
      pollRef.current = setInterval(() => { if (!document.hidden) fetchMatch(id); }, POLL_INTERVAL);
    }
  }, [fetchMatch, matches]);

  // Stop polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const liveCount = matches.filter(m => m.status === 'inProgress').length;

  return (
    <div className="max-w-[1400px] mx-auto reveal-up">
      {/* Page header */}
      <div className="mb-5 flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Live Analysis</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time match data powered by FotMob</p>
        </div>
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 ml-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {liveCount} live {liveCount === 1 ? 'match' : 'matches'}
          </span>
        )}
      </div>

      {/* Match selector */}
      <div className="mb-5">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">Today's Premier League Matches</p>
        {matchesLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="futura-panel p-3 h-16 skeleton-shimmer" />
            ))}
          </div>
        )}
        {matchesError && (
          <div className="futura-panel p-4 text-center text-sm text-rose-500">{matchesError}</div>
        )}
        {!matchesLoading && !matchesError && !matches.length && (
          <div className="futura-panel p-6 text-center">
            <p className="text-slate-500 font-medium">No Premier League matches today</p>
            <p className="text-xs text-slate-400 mt-1">Check back on a match day</p>
          </div>
        )}
        {!matchesLoading && matches.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {matches.map(m => (
              <MatchCard
                key={m.matchId}
                match={m}
                selected={selectedId === m.matchId}
                onClick={() => selectMatch(m.matchId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Match detail */}
      {selectedId && (
        <div>
          {matchLoading && !matchData && (
            <div className="grid gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="futura-panel p-6 h-32 skeleton-shimmer" />
              ))}
            </div>
          )}
          {matchError && (
            <div className="futura-panel p-4 text-center text-sm text-rose-500">{matchError}</div>
          )}
          {matchData && (
            <div className="space-y-4">
              {/* Score */}
              <ScoreHeader data={matchData} />

              {/* Possession bar */}
              <PossessionBar stats={matchData.stats} homeTeam={matchData.homeTeam} awayTeam={matchData.awayTeam} />

              {/* Events + Stats side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <EventsFeed events={matchData.events} homeId={matchData.homeTeam.id} />
                <StatsPanel stats={matchData.stats} homeTeam={matchData.homeTeam} awayTeam={matchData.awayTeam} />
              </div>

              {/* xG + Momentum */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <XgChart xgTimeline={matchData.xgTimeline} homeTeam={matchData.homeTeam} awayTeam={matchData.awayTeam} />
                <MomentumChart momentum={matchData.momentum} homeTeam={matchData.homeTeam} awayTeam={matchData.awayTeam} />
              </div>

              {/* Players */}
              {(matchData.lineup.home.length > 0 || matchData.lineup.away.length > 0) && (
                <div className="futura-panel p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Player Stats</h3>
                    <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                      <button
                        onClick={() => setActiveSide('home')}
                        className={`text-xs px-3 py-1 rounded-md font-semibold transition-all ${activeSide === 'home' ? 'bg-white shadow text-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {matchData.homeTeam.shortName || matchData.homeTeam.name}
                      </button>
                      <button
                        onClick={() => setActiveSide('away')}
                        className={`text-xs px-3 py-1 rounded-md font-semibold transition-all ${activeSide === 'away' ? 'bg-white shadow text-rose-500' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {matchData.awayTeam.shortName || matchData.awayTeam.name}
                      </button>
                    </div>
                  </div>
                  <PlayersTable
                    players={activeSide === 'home' ? matchData.lineup.home : matchData.lineup.away}
                    teamName={activeSide === 'home' ? matchData.homeTeam.name : matchData.awayTeam.name}
                    onSelectPlayer={setSelectedPlayer}
                  />
                  {!matchData.lineup.confirmed && (
                    <p className="text-[10px] text-slate-400 mt-2 text-center">Lineup not yet confirmed</p>
                  )}
                </div>
              )}

              {matchData.status === 'inProgress' && (
                <p className="text-center text-[10px] text-slate-400">
                  Auto-refreshing every 30s · Last updated {new Date().toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Player heatmap modal */}
      {selectedPlayer && (
        <HeatmapModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      )}
    </div>
  );
}
