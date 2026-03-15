import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import AdminLogin from './pages/AdminLogin';
import AdminPanel from './pages/AdminPanel';
import LiveAnalysis from './pages/LiveAnalysis';
import NewsSidebar from './components/NewsSidebar';
import AnalyticsTracker from './components/AnalyticsTracker';
import RequireAdmin from './components/RequireAdmin';

const NAV = [
  { to: '/',       label: 'Overview'       },
  { to: '/live',   label: 'Live Analysis'  },
  { to: '/players', label: 'Players'       },
];

export default function App() {
  return (
    <div className="app-shell min-h-screen">
      <header className="top-nav px-3 sm:px-6 sticky top-0 z-20">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 py-2 sm:py-0 sm:h-16">
          <div className="flex items-center gap-2 sm:gap-3 reveal-up reveal-fast min-w-0">
            <div className="brand-emblem flex-shrink-0">
              <span className="text-[11px] font-extrabold tracking-tight">FPL</span>
            </div>
            <div className="min-w-0 leading-tight">
              <p className="sm:hidden text-[15px] font-black text-slate-900 truncate">FPL AI Analysis</p>
              <p className="hidden sm:block text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">AI Analysis</p>
              <p className="hidden sm:block font-bold text-slate-900 text-sm -mt-0.5">FPL AI Analysis</p>
            </div>
          </div>

          <nav className="w-full sm:w-auto flex items-center gap-1.5 p-1 bg-white/80 border border-slate-200 rounded-xl shadow-[0_8px_20px_rgba(19,71,143,0.08)] reveal-up reveal-fast delay-1 overflow-x-auto">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-semibold whitespace-nowrap transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-[#0a84ff] to-[#00c4ff] text-white shadow-[0_8px_18px_rgba(10,132,255,0.25)]'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden sm:block reveal-up reveal-fast delay-2">
            <span className="hidden sm:inline-flex text-[11px] px-3 py-1.5 rounded-lg font-semibold futura-chip">
              White Futuristic UI
            </span>
          </div>
        </div>
      </header>

      <div className="flex">
        <NewsSidebar />
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6">
          <AnalyticsTracker />
          <Routes>
            <Route path="/"               element={<Dashboard />}    />
            <Route path="/players"        element={<Players />}      />
            <Route path="/players/:id"    element={<PlayerDetail />} />
            <Route path="/live"           element={<LiveAnalysis />} />
            <Route path="/admin/login"    element={<AdminLogin />} />
            <Route path="/admin"          element={<RequireAdmin><AdminPanel /></RequireAdmin>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
