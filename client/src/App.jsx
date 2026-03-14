import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import Fixtures from './pages/Fixtures';
import NewsSidebar from './components/NewsSidebar';

const NAV = [
  { to: '/',           label: 'Overview'   },
  { to: '/fixtures',   label: 'Fixtures'   },
  { to: '/players',    label: 'Players'    },
];

export default function App() {
  return (
    <div className="app-shell min-h-screen">
      <header className="top-nav px-6 sticky top-0 z-20">
        <div className="h-16 max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 reveal-up reveal-fast">
            <div className="brand-emblem">
              <span className="text-[11px] font-extrabold tracking-tight">FPL</span>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">AI Analysis</p>
              <p className="font-bold text-slate-900 text-sm -mt-0.5">FPL AI Analysis</p>
            </div>
          </div>

          <nav className="flex items-center gap-1.5 p-1 bg-white/80 border border-slate-200 rounded-xl shadow-[0_8px_20px_rgba(19,71,143,0.08)] reveal-up reveal-fast delay-1">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `text-sm px-4 py-2 rounded-lg font-semibold transition-all duration-200 ${
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

          <div className="reveal-up reveal-fast delay-2">
            <span className="hidden sm:inline-flex text-[11px] px-3 py-1.5 rounded-lg font-semibold futura-chip">
              White Futuristic UI
            </span>
          </div>
        </div>
      </header>

      <div className="flex">
        <NewsSidebar />
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6">
          <Routes>
            <Route path="/"               element={<Dashboard />}    />
            <Route path="/fixtures"       element={<Fixtures />}     />
            <Route path="/players"        element={<Players />}      />
            <Route path="/players/:id"    element={<PlayerDetail />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
