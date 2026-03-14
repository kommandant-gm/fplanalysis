import { useEffect, useState } from 'react';
import axios from 'axios';

const STATUS_CONFIG = {
  i: { label: 'Injured',    color: 'bg-rose-500',   text: 'text-rose-700',   bg: 'bg-rose-50',   border: 'border-rose-200' },
  d: { label: 'Doubtful',   color: 'bg-amber-400',  text: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  s: { label: 'Suspended',  color: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  u: { label: 'Unavailable',color: 'bg-slate-400',  text: 'text-slate-600',  bg: 'bg-slate-50',  border: 'border-slate-200' },
  n: { label: 'Not in squad',color:'bg-slate-300',  text: 'text-slate-500',  bg: 'bg-slate-50',  border: 'border-slate-200' },
};

const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

const SOURCE_COLOR = {
  'BBC Sport':   'bg-rose-100 text-rose-700',
  'Sky Sports':  'bg-sky-100 text-sky-700',
  'Guardian':    'bg-emerald-100 text-emerald-700',
  'r/FantasyPL': 'bg-orange-100 text-orange-700',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ChancePill({ value }) {
  if (value == null) return null;
  const color = value >= 75 ? 'bg-emerald-100 text-emerald-700'
              : value >= 50 ? 'bg-amber-100 text-amber-700'
              : value >= 25 ? 'bg-orange-100 text-orange-700'
              : 'bg-rose-100 text-rose-700';
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${color}`}>
      {value}%
    </span>
  );
}

export default function NewsSidebar() {
  const [open,       setOpen]       = useState(true);
  const [injuries,   setInjuries]   = useState([]);
  const [feed,       setFeed]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState('injuries');
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchNews = async () => {
    try {
      const { data } = await axios.get('/api/news');
      setInjuries(data.injuries || []);
      setFeed(data.feed || []);
      setLastUpdate(new Date());
    } catch {
      // silently fail — sidebar is non-critical
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 15 * 60 * 1000); // refresh every 15 min
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* Toggle button (always visible) */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'Hide news' : 'Show news'}
        className="fixed bottom-5 right-5 z-50 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 lg:hidden"
        style={{ background: 'linear-gradient(135deg,#0d7dff,#00b8f0)', boxShadow: '0 8px 20px rgba(10,132,255,0.3)' }}
      >
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          flex-shrink-0 transition-all duration-300 ease-in-out
          ${open ? 'w-72' : 'w-0 lg:w-10'}
          hidden lg:flex flex-col
          sticky top-14 h-[calc(100vh-3.5rem)]
          border-r border-slate-200 bg-white/95 backdrop-blur-sm overflow-hidden
        `}
        style={{ zIndex: 20 }}
      >
        {/* Collapsed rail */}
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-full flex items-center justify-center hover:bg-slate-50 transition-colors group"
            title="Show news"
          >
            <svg className="w-4 h-4 text-slate-400 group-hover:text-sky-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}

        {/* Full sidebar content */}
        {open && (
          <div className="flex flex-col h-full w-72 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#0d7dff,#00b8f0)' }}>
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
                  </svg>
                </div>
                <span className="text-xs font-black text-slate-800">FPL News</span>
                {lastUpdate && (
                  <span className="text-[9px] text-slate-400">{timeAgo(lastUpdate)}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={fetchNews} title="Refresh"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </button>
                <button onClick={() => setOpen(false)} title="Collapse"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-0.5 px-3 py-2 border-b border-slate-100 flex-shrink-0">
              {[
                { key: 'injuries', label: `Injuries (${injuries.length})` },
                { key: 'news',     label: `News (${feed.length})` },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded-lg transition-all ${
                    tab === t.key
                      ? 'bg-gradient-to-r from-sky-500 to-cyan-400 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-3 space-y-2">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="skeleton-shimmer" style={{ height: 56, borderRadius: 12 }} />
                  ))}
                </div>
              ) : tab === 'injuries' ? (
                <InjuriesTab injuries={injuries} />
              ) : (
                <NewsTab feed={feed} />
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function InjuriesTab({ injuries }) {
  if (!injuries.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-4">
        <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <p className="text-xs text-slate-400">No injury news — sync FPL data first</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {injuries.map(p => {
        const s = STATUS_CONFIG[p.status] || STATUS_CONFIG.u;
        const chance = p.chanceNext ?? p.chanceThis;
        return (
          <div key={p.id}
            className={`rounded-xl border ${s.border} ${s.bg} p-2.5 hover:shadow-sm transition-all`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.color}`} />
                  <p className="text-[11px] font-bold text-slate-800 truncate">{p.name}</p>
                  <span className="text-[9px] text-slate-400 font-medium bg-white/70 px-1 py-0.5 rounded">
                    {POS_LABEL[p.position]} · {p.team}
                  </span>
                </div>
                <p className={`text-[10px] mt-1 leading-snug ${s.text}`}>{p.news}</p>
              </div>
              <ChancePill value={chance} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewsTab({ feed }) {
  if (!feed.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 px-4 text-center">
        <p className="text-xs text-slate-400">No news items — RSS feeds may be unavailable</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {feed.map((item, i) => {
        const srcColor = SOURCE_COLOR[item.source] || 'bg-slate-100 text-slate-600';
        return (
          <a
            key={i}
            href={item.link || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl border border-slate-100 bg-white p-2.5 hover:border-slate-200 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center justify-between gap-1.5 mb-1">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${srcColor}`}>
                {item.source}
              </span>
              {item.pubDate && (
                <span className="text-[9px] text-slate-400">{timeAgo(item.pubDate)}</span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-slate-800 leading-snug group-hover:text-sky-700 transition-colors line-clamp-2">
              {item.title}
            </p>
            {item.description && (
              <p className="text-[10px] text-slate-400 mt-1 leading-snug line-clamp-2">
                {item.description}
              </p>
            )}
          </a>
        );
      })}
    </div>
  );
}
