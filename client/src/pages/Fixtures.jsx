import { useEffect, useState } from 'react';
import axios from 'axios';

const FDR_STYLE = {
  1: 'bg-emerald-500 text-white',
  2: 'bg-emerald-400 text-white',
  3: 'bg-amber-400 text-white',
  4: 'bg-red-400 text-white',
  5: 'bg-red-600 text-white',
};

function formatKickoff(raw) {
  if (!raw) return null;
  return new Date(raw).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function FDRBadge({ difficulty }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-black ${FDR_STYLE[difficulty] || 'bg-gray-200 text-gray-600'}`}>
      {difficulty}
    </span>
  );
}

function FixtureRow({ fixture }) {
  const { home_short, away_short, difficulty_home, difficulty_away,
          finished, score_home, score_away, kickoff_time } = fixture;

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-2.5 w-32 justify-end">
        <span className="font-semibold text-gray-800 text-sm">{home_short}</span>
        <FDRBadge difficulty={difficulty_home} />
      </div>

      <div className="flex flex-col items-center w-32 text-center">
        {finished ? (
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-gray-900">{score_home}</span>
            <span className="text-gray-300 font-light text-lg">–</span>
            <span className="text-xl font-black text-gray-900">{score_away}</span>
          </div>
        ) : (
          <>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">vs</span>
            {kickoff_time && <span className="text-xs text-gray-400 mt-0.5">{formatKickoff(kickoff_time)}</span>}
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5 w-32">
        <FDRBadge difficulty={difficulty_away} />
        <span className="font-semibold text-gray-800 text-sm">{away_short}</span>
      </div>
    </div>
  );
}

function GWCard({ title, badge, badgeColor, fixtures, footer }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex-1 min-w-0">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{fixtures.length} fixtures</p>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-lg ${badgeColor}`}>{badge}</span>
      </div>

      {/* FDR legend */}
      <div className="flex items-center gap-2 px-5 py-2 bg-gray-50 border-b border-gray-100 flex-wrap">
        <span className="text-xs text-gray-400 font-medium">FDR:</span>
        {[1,2,3,4,5].map(n => <FDRBadge key={n} difficulty={n} />)}
        <span className="text-xs text-gray-400">1 = easiest · 5 = hardest</span>
      </div>

      {fixtures.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">No fixtures — sync FPL data first.</div>
      ) : (
        fixtures.map(f => <FixtureRow key={f.id} fixture={f} />)
      )}

      {footer && (
        <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400">{footer}</p>
        </div>
      )}
    </div>
  );
}

export default function Fixtures() {
  const [data, setData]       = useState({ current: [], next: [], currentGW: null, nextGW: null });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    axios.get('/api/fixtures/upcoming')
      .then(res => setData(res.data))
      .catch(() => setError('Could not load fixtures. Is the server running?'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 bg-gray-200 rounded-lg animate-pulse" />
        <div className="flex gap-5">
          {[0,1].map(i => (
            <div key={i} className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              {[...Array(10)].map((_, j) => <div key={j} className="h-8 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
        ⚠ {error}
      </div>
    );
  }

  const played = data.current.filter(f => f.finished).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Fixtures</h1>
        <p className="text-sm text-gray-400 mt-0.5">Current and next gameweek with difficulty ratings</p>
      </div>

      <div className="flex gap-5 flex-col lg:flex-row">
        <GWCard
          title={data.currentGW ? `GW ${data.currentGW}` : 'Current GW'}
          badge="Current"
          badgeColor="bg-[#37003c] text-[#00ff85]"
          fixtures={data.current}
          footer={`${played} / ${data.current.length} matches played`}
        />
        <GWCard
          title={data.nextGW ? `GW ${data.nextGW}` : 'Next GW'}
          badge="Upcoming"
          badgeColor="bg-emerald-100 text-emerald-700"
          fixtures={data.next}
        />
      </div>
    </div>
  );
}
