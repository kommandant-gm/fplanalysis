import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

/* ─── Constants ─────────────────────────────────────────── */
const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POS_COLORS = {
  1: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: '#d97706' },
  2: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#059669' },
  3: { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200',     dot: '#0284c7' },
  4: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', dot: '#a21caf' },
};
const FDR_COLORS = {
  1: 'bg-emerald-500 text-white',
  2: 'bg-emerald-400 text-white',
  3: 'bg-amber-400 text-amber-900',
  4: 'bg-orange-500 text-white',
  5: 'bg-rose-600 text-white',
};
const ACCENTS = {
  cyan:   { strip: 'from-cyan-400 via-sky-500 to-blue-500',    chip: 'bg-sky-50 text-sky-700 border-sky-200',         bar: 'from-sky-500 to-cyan-400',      dot: '#0284c7' },
  green:  { strip: 'from-emerald-400 via-teal-500 to-cyan-400', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'from-emerald-500 to-teal-400', dot: '#059669' },
  violet: { strip: 'from-violet-500 via-indigo-500 to-blue-500', chip: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'from-violet-500 to-indigo-400', dot: '#7c3aed' },
  amber:  { strip: 'from-amber-400 via-orange-400 to-rose-400',  chip: 'bg-amber-50 text-amber-700 border-amber-200',   bar: 'from-amber-400 to-orange-400',  dot: '#d97706' },
};

const toNum = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

/* ─── Primitives ─────────────────────────────────────────── */
function PosBadge({ pos }) {
  const c = POS_COLORS[pos] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' };
  return (
    <span className={`inline-flex items-center rounded-md text-[10px] px-1.5 py-0.5 font-black border ${c.bg} ${c.text} ${c.border}`}>
      {POS_LABEL[pos] || pos}
    </span>
  );
}

function FDRBadge({ fdr }) {
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-black ${FDR_COLORS[fdr] || 'bg-slate-200 text-slate-600'}`}>
      {fdr}
    </span>
  );
}

function AnimBar({ value, max = 100, accent = 'cyan', delay = 0 }) {
  const [w, setW] = useState(0);
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  const a = ACCENTS[accent] || ACCENTS.cyan;
  useEffect(() => {
    const t = setTimeout(() => setW(pct), 120 + delay);
    return () => clearTimeout(t);
  }, [pct, delay]);
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-1.5 rounded-full bg-gradient-to-r ${a.bar} glow-line`}
        style={{ width: `${w}%`, transition: 'width 900ms cubic-bezier(0.2,0.8,0.2,1)' }}
      />
    </div>
  );
}

function Skeleton({ rows = 5 }) {
  return (
    <div className="p-4 space-y-3">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="skeleton-shimmer" style={{ height: 44, animationDelay: `${i * 60}ms`, borderRadius: 12 }} />
      ))}
    </div>
  );
}

function SectionTag({ label, accent = 'cyan' }) {
  const a = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div className={`section-label ${a.chip} rounded-md px-2 py-1 border`}>
      {label}
    </div>
  );
}

/* ─── Panel shell ────────────────────────────────────────── */
function Panel({ title, subtitle, tag, accent = 'cyan', actions, className = '', children }) {
  const a = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <section className={`futura-panel reveal-up overflow-hidden ${className}`}>
      <div className={`h-[3px] w-full bg-gradient-to-r ${a.strip}`} />
      <header className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          {tag && <SectionTag label={tag} accent={accent} />}
          <h2 className="text-sm font-bold text-slate-800 leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex-shrink-0">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/* ─── Fixture Win Probabilities ──────────────────────────── */
function FixtureProbPanel({ gameweek, fixtures, loading }) {
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const pct = (n) => `${(toNum(n, 0) * 100).toFixed(1)}%`;

  return (
    <section className="futura-panel reveal-up overflow-hidden">
      <div className="h-[3px] w-full bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500" />
      <header className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center gap-3">
        <span className="section-label text-[10px] text-sky-700 font-black tracking-[0.14em] uppercase">
          Fixture Win Probabilities
        </span>
        {gameweek && (
          <span className="ml-auto text-[10px] font-bold px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-200">
            GW{gameweek}
          </span>
        )}
      </header>

      {loading ? (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton-shimmer" style={{ height: 100, borderRadius: 14 }} />
          ))}
        </div>
      ) : fixtures.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No fixture probability data — sync first</p>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {fixtures.map((f, idx) => {
            const h  = toNum(f?.probabilities?.home_win, 0);
            const d  = toNum(f?.probabilities?.draw, 0);
            const aw = toNum(f?.probabilities?.away_win, 0);
            const winner = h >= aw && h >= d ? 'home' : aw >= d ? 'away' : 'draw';
            return (
              <article
                key={f.id}
                className="fixture-card p-3 reveal-up"
                style={{ animationDelay: `${idx * 45}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-900 tracking-tight">
                    {f.home_short} <span className="text-slate-300 font-light">vs</span> {f.away_short}
                  </p>
                  {fmt(f.kickoff_time) && (
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                      {fmt(f.kickoff_time)}
                    </span>
                  )}
                </div>

                {/* Tri-probability bar */}
                <div className="mt-2.5 h-2.5 rounded-full overflow-hidden flex">
                  <div className="prob-bar-home h-2.5 transition-all duration-1000"
                    style={{ width: `${Math.max(1, h * 100)}%` }} />
                  <div className="prob-bar-draw h-2.5 transition-all duration-1000"
                    style={{ width: `${Math.max(1, d * 100)}%` }} />
                  <div className="prob-bar-away h-2.5 transition-all duration-1000"
                    style={{ width: `${Math.max(1, aw * 100)}%` }} />
                </div>

                <div className="mt-1.5 grid grid-cols-3 text-[10px]">
                  <span className={`font-bold ${winner === 'home' ? 'text-rose-500' : 'text-slate-400'}`}>
                    {f.home_short} {pct(h)}
                  </span>
                  <span className={`text-center font-bold ${winner === 'draw' ? 'text-slate-700' : 'text-slate-400'}`}>
                    D {pct(d)}
                  </span>
                  <span className={`text-right font-bold ${winner === 'away' ? 'text-cyan-600' : 'text-slate-400'}`}>
                    {f.away_short} {pct(aw)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">
                    xG {toNum(f?.expected_goals?.home, 0).toFixed(2)} – {toNum(f?.expected_goals?.away, 0).toFixed(2)}
                  </span>
                  {f?.likely_scoreline && (
                    <span className="text-[10px] font-black text-sky-600 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-md">
                      {f.likely_scoreline.home}–{f.likely_scoreline.away}
                    </span>
                  )}
                </div>

                {(f?.likely_scorers?.home?.length > 0 || f?.likely_scorers?.away?.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(f.likely_scorers?.home || [])
                      .slice(0, Math.max(1, Math.min(3, toNum(f?.likely_scoreline?.home, 1))))
                      .map((s) => (
                      <span key={`h-${s.id}`} className="text-[10px] px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-100">
                        {s.name} {(toNum(s.goal_probability, 0) * 100).toFixed(0)}%
                      </span>
                    ))}
                    {(f.likely_scorers?.away || [])
                      .slice(0, Math.max(1, Math.min(3, toNum(f?.likely_scoreline?.away, 1))))
                      .map((s) => (
                      <span key={`a-${s.id}`} className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-600 border border-cyan-100">
                        {s.name} {(toNum(s.goal_probability, 0) * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ─── xPts Leaders ───────────────────────────────────────── */
function XptsLeadersPanel({ rows, loading }) {
  const max = rows.length ? Math.max(...rows.map(r => toNum(r.value, 0))) : 1;
  return (
    <Panel title="xPts Leaders" subtitle="Highest expected points this GW" tag="XPTS" accent="cyan">
      {loading ? <Skeleton /> : (
        <div className="p-3 space-y-2">
          {rows.map((r, i) => (
            <article key={r.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-black text-slate-300 w-4 flex-shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{r.name}</p>
                    <p className="text-[10px] text-slate-400">{r.team}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <PosBadge pos={r.position} />
                  <span className="text-sm font-black text-sky-600 tabular-nums">{toNum(r.value, 0).toFixed(1)}</span>
                </div>
              </div>
              <div className="mt-2">
                <AnimBar value={toNum(r.value, 0)} max={max} accent="cyan" delay={i * 50} />
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ─── Form Leaders ───────────────────────────────────────── */
function FormLeadersPanel({ rows, loading }) {
  const scoreColor = (v) => {
    if (v >= 9)  return 'bg-emerald-500 text-white';
    if (v >= 7)  return 'bg-teal-500 text-white';
    if (v >= 5)  return 'bg-sky-500 text-white';
    return 'bg-slate-200 text-slate-700';
  };
  return (
    <Panel title="Form Leaders" subtitle="Highest FPL form score" tag="FORM" accent="green">
      {loading ? <Skeleton /> : (
        <div className="p-3 space-y-2">
          {rows.map((r, i) => (
            <article key={r.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-black text-slate-300 w-4 flex-shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{r.name}</p>
                    <p className="text-[10px] text-slate-400">{r.team}</p>
                  </div>
                </div>
                <span className={`score-badge text-sm font-black px-2.5 py-1 rounded-lg tabular-nums flex-shrink-0 ${scoreColor(toNum(r.value, 0))}`}
                  style={{ animationDelay: `${i * 70}ms` }}>
                  {toNum(r.value, 0).toFixed(1)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ─── Goal Probability ───────────────────────────────────── */
function GoalProbPanel({ rows, loading }) {
  const max = rows.length ? Math.max(...rows.map(r => toNum(r.value, 0))) : 100;
  return (
    <Panel title="Goal Probability" subtitle="Most likely scorers this gameweek" tag="GOAL PROB" accent="violet">
      {loading ? <Skeleton /> : (
        <div className="p-3 space-y-2">
          {rows.map((r, i) => {
            const c = POS_COLORS[r.position] || POS_COLORS[4];
            const initials = r.name.split(' ').map(n => n[0]).slice(0, 2).join('');
            return (
              <article key={r.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${c.bg}`}
                    style={{ borderColor: c.dot }}>
                    <span className={`text-[9px] font-black ${c.text}`}>{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-800 truncate">{r.name}</p>
                      <span className="text-sm font-black text-violet-600 tabular-nums flex-shrink-0">
                        {toNum(r.value, 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <AnimBar value={toNum(r.value, 0)} max={max} accent="violet" delay={i * 50} />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ─── Captain Picks ──────────────────────────────────────── */
function CaptainPanel({ captains, loading }) {
  return (
    <Panel title="Captain Picks" subtitle="Armband candidates by return profile" tag="CAPTAIN" accent="amber">
      {loading ? <Skeleton /> : (
        <div className="p-3 space-y-2">
          {(captains || []).slice(0, 5).map((p, i) => (
            <article key={p.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-black text-white"
                    style={{ background: 'linear-gradient(135deg,#f59e0b,#f97316)' }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400">{p.team}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-slate-900 tabular-nums">
                    {p.likely_pts}<span className="text-[10px] text-slate-400 font-normal ml-0.5">pts</span>
                  </p>
                  <p className="text-[10px] text-amber-600 font-semibold">{toNum(p.xpts, 0).toFixed(1)} xPts</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <PosBadge pos={p.position} />
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  FDR <FDRBadge fdr={p.fdr} />
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ─── Transfer Targets ───────────────────────────────────── */
function TransferPanel({ transfers, loading }) {
  const [filter, setFilter] = useState('ALL');
  const posMap = { ALL: null, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
  const rows = Array.isArray(transfers?.data) ? transfers.data : [];
  const best = Array.isArray(transfers?.best_by_position) ? transfers.best_by_position : [];
  const filtered = posMap[filter] ? rows.filter(r => r.position === posMap[filter]) : rows;

  return (
    <Panel
      title="Transfer Targets"
      subtitle="Best in/out pairs with 3GW xPts gain"
      tag="TRANSFER"
      accent="cyan"
      actions={
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`text-[10px] px-2 py-1 rounded-md font-bold transition-all ${
                filter === k
                  ? 'bg-gradient-to-r from-sky-500 to-cyan-400 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white'
              }`}>
              {k}
            </button>
          ))}
        </div>
      }
    >
      {loading ? <Skeleton rows={6} /> : (
        <div className="p-3 space-y-3">
          {best.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {best.map((b) => (
                <article key={`best-${b.position}-${b.in?.id}`}
                  className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <PosBadge pos={b.position} />
                        <p className="text-[11px] font-bold text-slate-800 truncate">{b.in?.name}</p>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{b.in?.team}</p>
                    </div>
                    <span className="text-xs font-black text-emerald-600 flex-shrink-0">
                      +{toNum(b.gain, 0).toFixed(1)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {filtered.slice(0, 5).map((t, i) => (
              <article key={`${t.in?.id}-${t.out?.id}`}
                className="leader-row px-3 py-2.5 reveal-up"
                style={{ animationDelay: `${i * 55}ms` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <PosBadge pos={t.position} />
                      <p className="text-xs font-bold text-slate-800 truncate">{t.in?.name}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {t.in?.team} · £{toNum(t.in?.price, 0).toFixed(1)}m
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-black text-emerald-600">+{toNum(t.gain, 0).toFixed(1)}</p>
                    <p className="text-[10px] text-slate-400">xPts gain</p>
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  OUT <span className="line-through text-slate-300">{t.out?.name}</span>
                  <span className="ml-1">({t.out?.xpts} xPts)</span>
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ─── Best By Position ───────────────────────────────────── */
function BestByPositionPanel({ players, loading }) {
  const best = useMemo(() => {
    const by = { 1: null, 2: null, 3: null, 4: null };
    for (const p of players) {
      if (!by[p.position] || toNum(p.xpts, 0) > toNum(by[p.position].xpts, 0)) by[p.position] = p;
    }
    return by;
  }, [players]);

  return (
    <Panel title="Best by Position" subtitle="Top projection in each role" tag="ROLE BEST" accent="green">
      {loading ? <Skeleton rows={4} /> : (
        <div className="p-3 space-y-2">
          {[1, 2, 3, 4].map((pos, i) => {
            const p = best[pos];
            const c = POS_COLORS[pos];
            return (
              <article key={pos} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 70}ms` }}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center border ${c.bg} ${c.border}`}>
                    <span className={`text-[10px] font-black ${c.text}`}>{POS_LABEL[pos]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{p?.name || '—'}</p>
                    <p className="text-[10px] text-slate-400">{p?.team || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black text-slate-900 tabular-nums">
                      {p ? toNum(p.likely_pts, 0).toFixed(0) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">likely pts</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ─── Clean Sheet Picks ──────────────────────────────────── */
function CleanSheetPanel({ players, loading }) {
  const rows = [...players]
    .filter(p => p.position <= 2 && toNum(p.cs_prob, 0) > 0)
    .sort((a, b) => toNum(b.cs_prob, 0) - toNum(a.cs_prob, 0))
    .slice(0, 8);

  return (
    <Panel title="Clean Sheet Picks" subtitle="Goalkeepers and defenders with strongest CS odds" tag="CS MODEL" accent="green">
      {loading ? <Skeleton rows={6} /> : (
        <div className="p-3 space-y-2">
          {rows.map((r, i) => {
            const pct = toNum(r.cs_prob, 0) * 100;
            const color = pct >= 60 ? 'text-emerald-600' : pct >= 40 ? 'text-teal-600' : 'text-sky-600';
            return (
              <article key={r.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <PosBadge pos={r.position} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{r.name}</p>
                      <p className="text-[10px] text-slate-400">{r.team}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-black tabular-nums flex-shrink-0 ${color}`}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2">
                  <AnimBar value={pct} max={100} accent="green" delay={i * 55} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ─── Trend Chart ────────────────────────────────────────── */
function RotationRiskPanel({ rows, loading }) {
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [query, setQuery] = useState('');

  const teams = useMemo(
    () => Array.from(new Set((rows || []).map(r => r.team).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  useEffect(() => {
    if (teamFilter !== 'ALL' && !teams.includes(teamFilter)) setTeamFilter('ALL');
  }, [teamFilter, teams]);

  const riskBand = (risk) => {
    if (risk >= 70) return 'HIGH';
    if (risk >= 45) return 'MID';
    return 'LOW';
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((p) => {
      if (teamFilter !== 'ALL' && p.team !== teamFilter) return false;
      if (positionFilter !== 'ALL' && toNum(p.position, 0) !== Number(positionFilter)) return false;
      if (riskFilter !== 'ALL' && riskBand(toNum(p.rotation_risk, 0)) !== riskFilter) return false;
      if (!q) return true;
      const haystack = `${p.name || ''} ${p.team || ''} ${p.substitution_pattern || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, teamFilter, positionFilter, riskFilter, query]);

  const riskColor = (risk) => {
    if (risk >= 70) return 'bg-rose-100 text-rose-700 border border-rose-200';
    if (risk >= 45) return 'bg-amber-100 text-amber-700 border border-amber-200';
    return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  };

  return (
    <Panel
      title="Minutes Played / Rotation Risk"
      subtitle="Substitution pattern, squad rotation risk and avg minutes from FPL + FotMob"
      tag="MINUTES RISK"
      accent="amber"
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="h-8 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white px-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="ALL">All Teams</option>
            {teams.map((team) => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="h-8 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white px-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="ALL">All Pos</option>
            <option value="1">GKP</option>
            <option value="2">DEF</option>
            <option value="3">MID</option>
            <option value="4">FWD</option>
          </select>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="h-8 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white px-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="ALL">All Risk</option>
            <option value="HIGH">High Risk</option>
            <option value="MID">Mid Risk</option>
            <option value="LOW">Low Risk</option>
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player"
            className="h-8 w-36 text-[11px] rounded-lg border border-slate-200 bg-white px-2 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
        </div>
      }
    >
      {loading ? <Skeleton rows={6} /> : filteredRows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No players match the current team/search filters</p>
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-[10px] text-slate-400 px-1">
            Showing {filteredRows.length} of {rows.length} players
          </p>
          <div className="max-h-[760px] overflow-y-auto pr-1 space-y-2">
            {filteredRows.map((p, i) => (
              <article key={p.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 45}ms` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <PosBadge pos={p.position} />
                      <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{p.team} · {p.substitution_pattern}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-md ${riskColor(toNum(p.rotation_risk, 0))}`}>
                      {toNum(p.rotation_risk, 0).toFixed(0)} risk
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">{toNum(p.avg_minutes_combined, 0).toFixed(1)} avg mins</p>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                    <p className="text-slate-400">FPL avg</p>
                    <p className="font-black text-slate-700">{p.avg_minutes_fpl != null ? toNum(p.avg_minutes_fpl, 0).toFixed(1) : '-'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                    <p className="text-slate-400">FotMob avg</p>
                    <p className="font-black text-slate-700">{p.avg_minutes_fotmob != null ? toNum(p.avg_minutes_fotmob, 0).toFixed(1) : '-'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                    <p className="text-slate-400">mins prob</p>
                    <p className="font-black text-slate-700">{(toNum(p.mins_prob, 0) * 100).toFixed(0)}%</p>
                  </div>
                </div>

                <div className="mt-2 space-y-1.5">
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>Start rate</span>
                      <span>{(toNum(p?.substitution_stats?.start_rate, 0) * 100).toFixed(0)}%</span>
                    </div>
                    <AnimBar value={toNum(p?.substitution_stats?.start_rate, 0) * 100} max={100} accent="green" delay={i * 35} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>Sub-on rate</span>
                      <span>{(toNum(p?.substitution_stats?.sub_on_rate, 0) * 100).toFixed(0)}%</span>
                    </div>
                    <AnimBar value={toNum(p?.substitution_stats?.sub_on_rate, 0) * 100} max={100} accent="cyan" delay={i * 35} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>Cameo rate</span>
                      <span>{(toNum(p?.substitution_stats?.cameo_rate, 0) * 100).toFixed(0)}%</span>
                    </div>
                    <AnimBar value={toNum(p?.substitution_stats?.cameo_rate, 0) * 100} max={100} accent="amber" delay={i * 35} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function TrendPanel({ trend, loading }) {
  if (loading) {
    return (
      <Panel title="Gameweek Trend" subtitle="Average historical FPL points across tracked players" tag="TREND" accent="violet" className="xl:col-span-2">
        <Skeleton rows={6} />
      </Panel>
    );
  }
  if (!trend.length) {
    return (
      <Panel title="Gameweek Trend" subtitle="Average historical FPL points across tracked players" tag="TREND" accent="violet" className="xl:col-span-2">
        <p className="text-xs text-slate-400 text-center py-10">No historical GW data yet</p>
      </Panel>
    );
  }

  const values = trend.map(t => toNum(t.avg_points, 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const W = 700; const H = 200; const PAD = 20;
  const getXY = (v, i) => {
    const x = PAD + (i * (W - PAD * 2)) / Math.max(values.length - 1, 1);
    const y = H - PAD - ((v - min) / Math.max(max - min, 1)) * (H - PAD * 2);
    return [x, y];
  };
  const polyPts = values.map((v, i) => getXY(v, i).join(',')).join(' ');
  const areaPath = [
    `M${PAD},${H - PAD}`,
    ...values.map((v, i) => { const [x, y] = getXY(v, i); return `L${x},${y}`; }),
    `L${getXY(values[values.length - 1], values.length - 1)[0]},${H - PAD}`,
    'Z',
  ].join(' ');

  return (
    <Panel title="Gameweek Trend" subtitle="Average historical FPL points across tracked players" tag="TREND" accent="violet" className="xl:col-span-2">
      <div className="p-4">
        <div className="rounded-2xl border border-violet-100 bg-gradient-to-b from-violet-50/40 to-white p-3 overflow-hidden">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
            <defs>
              <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <line key={t} x1={PAD} y1={PAD + t * (H - PAD * 2)} x2={W - PAD} y2={PAD + t * (H - PAD * 2)}
                stroke="#ede9fe" strokeWidth="1" />
            ))}
            <path d={areaPath} fill="url(#trendGrad)" />
            <polyline points={polyPts} fill="none" stroke="#7c3aed" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" />
            {values.map((v, i) => {
              const [x, y] = getXY(v, i);
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="4.5" fill="#fff" stroke="#7c3aed" strokeWidth="2" />
                  <circle cx={x} cy={y} r="2"   fill="#7c3aed" />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
          {trend.map((t) => (
            <span key={t.gameweek} className="text-[10px] text-slate-400">GW{t.gameweek}</span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ─── Momentum Panel ─────────────────────────────────────── */
function MomentumPanel({ rows, loading }) {
  return (
    <Panel title="Momentum Picks" subtitle="Improving players from recent gameweeks" tag="MOMENTUM" accent="cyan">
      {loading ? <Skeleton rows={5} /> : rows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No momentum data yet</p>
      ) : (
        <div className="p-3 space-y-2">
          {rows.map((p, i) => {
            const mom = toNum(p.momentum, 0);
            const up = mom >= 0;
            return (
              <article key={p.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 55}ms` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      last3 {toNum(p.avg_last3, 0).toFixed(1)} · last6 {toNum(p.avg_last6, 0).toFixed(1)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-black tabular-nums ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {up ? '+' : ''}{mom.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-slate-400">trend</p>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <PosBadge pos={p.position} />
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {toNum(p.next_xpts, 0).toFixed(1)} next xPts
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ─── Sparkline ──────────────────────────────────────────── */
function Sparkline({ values, color = '#0a84ff' }) {
  if (!values?.length || values.length < 2) {
    return <div className="h-8 w-28 rounded-lg bg-slate-50 border border-slate-100" />;
  }
  const W = 120; const H = 34; const P = 4;
  const min = Math.min(...values); const max = Math.max(...values);
  const pts = values.map((v, i) => {
    const x = P + (i * (W - P * 2)) / Math.max(values.length - 1, 1);
    const y = H - P - ((v - min) / Math.max(max - min, 1)) * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── History Compare ────────────────────────────────────── */
function HistoryComparePanel({ players, loading }) {
  return (
    <Panel title="Past GW vs Next xPts" subtitle="Top predicted players with recent GW trend" tag="HISTORY COMPARE" accent="amber">
      {loading ? <Skeleton rows={6} /> : players.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No historical data — sync first</p>
      ) : (
        <div className="p-3 space-y-2">
          {players.map((p, i) => {
            const mom = toNum(p.momentum, 0);
            return (
              <article key={p.id} className="leader-row px-3 py-2.5 reveal-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400">{p.team} · {p.history?.length || 0} GW samples</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                      mom >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                               : 'bg-rose-50 text-rose-600 border border-rose-200'}`}>
                      {mom >= 0 ? '+' : ''}{mom.toFixed(2)}
                    </span>
                    <span className="text-sm font-black text-amber-600 tabular-nums">
                      {toNum(p.xpts, 0).toFixed(1)}
                      <span className="text-[10px] font-normal text-slate-400 ml-0.5">xPts</span>
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <Sparkline values={p.history_points || []} color="#0a84ff" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ─── Points Heatmap ─────────────────────────────────────── */
function HeatmapPanel({ players, loading }) {
  const { gwLabels, rows, maxPts } = useMemo(() => {
    const labels = Array.from(
      new Set(players.flatMap(p => (p.history || []).map(h => h.gameweek)))
    ).sort((a, b) => a - b);
    const mapped = players.map((p) => {
      const map = {};
      (p.history || []).forEach(h => { map[h.gameweek] = toNum(h.points, 0); });
      return { id: p.id, name: p.name, values: labels.map(gw => map[gw] ?? null) };
    });
    const max = Math.max(1, ...mapped.flatMap(r => r.values).filter(v => v != null));
    return { gwLabels: labels, rows: mapped, maxPts: max };
  }, [players]);

  const cell = (v) => {
    if (v == null) return { backgroundColor: '#f8fafc', color: '#94a3b8' };
    const ratio = Math.min(v / maxPts, 1);
    const alpha = 0.10 + ratio * 0.75;
    return {
      backgroundColor: `rgba(14,165,233,${alpha.toFixed(3)})`,
      color: ratio > 0.5 ? '#fff' : '#1e3a5f',
    };
  };

  return (
    <Panel title="Past GW Points Heatmap" subtitle="Historical FPL points per GW for top predicted players" tag="HEATMAP" accent="violet">
      {loading ? <Skeleton rows={6} /> : rows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No gameweek history available</p>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="text-left px-2 py-2 text-[11px] text-slate-400 font-bold">Player</th>
                {gwLabels.map(gw => (
                  <th key={gw} className="text-center px-1 py-2 text-[10px] text-slate-400 font-bold">GW{gw}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-2 py-2 font-bold text-slate-700 whitespace-nowrap text-[11px]">{row.name}</td>
                  {row.values.map((v, idx) => (
                    <td key={`${row.id}-${idx}`} className="px-1 py-1.5 text-center">
                      <div className="w-8 h-7 rounded-lg mx-auto flex items-center justify-center text-[10px] font-black transition-all"
                        style={cell(v)}>
                        {v ?? '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────── */
export default function Dashboard() {
  const [players,     setPlayers]     = useState([]);
  const [captains,    setCaptains]    = useState([]);
  const [transfers,   setTransfers]   = useState({ data: [], best_by_position: [], gameweeks: [] });
  const [fixProbs,    setFixProbs]    = useState([]);
  const [rotationRows, setRotationRows] = useState([]);
  const [insights,    setInsights]    = useState({ trend: [], players: [], momentum: [] });

  const [loading,         setLoading]         = useState(true);
  const [captainLoading,  setCaptainLoading]  = useState(true);
  const [transferLoading, setTransferLoading] = useState(true);
  const [fixProbLoading,  setFixProbLoading]  = useState(true);
  const [rotationLoading, setRotationLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [error,    setError]    = useState(null);
  const [gameweek, setGameweek] = useState(null);
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setError(null);
      setLoading(true); setCaptainLoading(true); setTransferLoading(true);
      setFixProbLoading(true); setRotationLoading(true); setInsightsLoading(true);
      try {
        const res = await axios.get('/api/players');
        if (!active) return;
        const gw = res.data.gameweek;
        setPlayers(res.data.data || []);
        setGameweek(gw);
        setLoading(false);

        const [capR, trnR, fpR, rotR, insR] = await Promise.allSettled([
          axios.get(`/api/predictions/captain?gw=${gw}`),
          axios.get('/api/predictions/transfers'),
          axios.get(`/api/fixtures/probabilities?gw=${gw}`),
          axios.get(`/api/predictions/rotation-risk?gw=${gw}&sort=xpts`),
          axios.get(`/api/predictions/insights?gw=${gw}`),
        ]);
        if (!active) return;

        setCaptains(capR.status === 'fulfilled' ? (capR.value.data.data || []) : []);
        setCaptainLoading(false);

        if (trnR.status === 'fulfilled') {
          const d = trnR.value.data || {};
          setTransfers({
            data: Array.isArray(d.data) ? d.data : [],
            best_by_position: Array.isArray(d.best_by_position) ? d.best_by_position : [],
            gameweeks: Array.isArray(d.gameweeks) ? d.gameweeks : [],
          });
        } else setTransfers({ data: [], best_by_position: [], gameweeks: [] });
        setTransferLoading(false);

        setFixProbs(fpR.status === 'fulfilled' ? (fpR.value.data.data || []) : []);
        setFixProbLoading(false);

        setRotationRows(rotR.status === 'fulfilled' ? (rotR.value.data.data || []) : []);
        setRotationLoading(false);

        if (insR.status === 'fulfilled') {
          setInsights({
            trend:    insR.value.data.trend    || [],
            players:  insR.value.data.players  || [],
            momentum: insR.value.data.momentum || [],
          });
        } else setInsights({ trend: [], players: [], momentum: [] });
        setInsightsLoading(false);
      } catch {
        if (!active) return;
        setError('Could not load data. Is the server running?');
        [setLoading, setCaptainLoading, setTransferLoading, setFixProbLoading, setRotationLoading, setInsightsLoading]
          .forEach(fn => fn(false));
      }
    };
    load();
    return () => { active = false; };
  }, [syncTick]);

  const xptsRows = useMemo(() =>
    [...players].sort((a, b) => toNum(b.xpts, 0) - toNum(a.xpts, 0)).slice(0, 8)
      .map(p => ({ id: p.id, name: p.name, team: p.team, position: p.position, value: toNum(p.xpts, 0) })),
  [players]);

  const formRows = useMemo(() =>
    [...players].sort((a, b) => toNum(b.form, 0) - toNum(a.form, 0)).slice(0, 8)
      .map(p => ({ id: p.id, name: p.name, team: p.team, position: p.position, value: toNum(p.form, 0) })),
  [players]);

  const goalRows = useMemo(() =>
    [...players].filter(p => toNum(p.xg_prob, 0) > 0)
      .sort((a, b) => toNum(b.xg_prob, 0) - toNum(a.xg_prob, 0)).slice(0, 8)
      .map(p => ({ id: p.id, name: p.name, team: p.team, position: p.position, value: toNum(p.xg_prob, 0) * 100 })),
  [players]);


  return (
    <div className="space-y-5">

      {/* ── Hero Header ─────────────────────────────────────── */}
      <section className="futura-panel reveal-up overflow-hidden">
        <div className="h-[3px] w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />

        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0d7dff,#00b8f0)', boxShadow: '0 10px 24px rgba(10,132,255,0.30)' }}>
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.20em] text-slate-400 font-bold">
                Prediction + Historical Model
              </p>
              <h1 className="text-2xl font-black text-slate-900 mt-0.5 tracking-tight">
                {gameweek ? `GW${gameweek} Overview` : 'FPL Overview'}
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Predictions · Historical Trends · Signal Analysis
              </p>
            </div>
          </div>

        </div>

      </section>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 px-5 py-3 text-sm font-medium">
          ⚠ {error}
        </div>
      )}

      {/* ── Fixture Win Probabilities ────────────────────────── */}
      <FixtureProbPanel gameweek={gameweek} fixtures={fixProbs} loading={fixProbLoading} />

      {/* ── Three leader panels ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {loading ? (
          <>
            <Panel title="xPts Leaders"     tag="XPTS"      accent="cyan"><Skeleton /></Panel>
            <Panel title="Form Leaders"     tag="FORM"      accent="green"><Skeleton /></Panel>
            <Panel title="Goal Probability" tag="GOAL PROB" accent="violet"><Skeleton /></Panel>
          </>
        ) : (
          <>
            <XptsLeadersPanel rows={xptsRows} loading={loading} />
            <FormLeadersPanel rows={formRows} loading={loading} />
            <GoalProbPanel    rows={goalRows} loading={loading} />
          </>
        )}
      </div>

      {/* ── Captain · Transfers · Best by position ───────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <CaptainPanel       captains={captains}   loading={captainLoading}  />
        <TransferPanel      transfers={transfers} loading={transferLoading} />
        <BestByPositionPanel players={players}    loading={loading}         />
      </div>

      {/* ── Clean sheet ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5">
        <CleanSheetPanel players={players} loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-5">
        <RotationRiskPanel rows={rotationRows} loading={rotationLoading} />
      </div>

      {/* ── Momentum ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5">
        <MomentumPanel rows={insights.momentum || []} loading={insightsLoading} />
      </div>

      {/* ── Points heatmap ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5">
        <HeatmapPanel players={insights.players || []} loading={insightsLoading} />
      </div>

    </div>
  );
}
