import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import Fixtures from './pages/Fixtures';

const NAV = [
  { to: '/',           label: 'Overview'   },
  { to: '/fixtures',   label: 'Fixtures'   },
  { to: '/players',    label: 'Players'    },
];

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 px-6 sticky top-0 z-10">
        <div className="flex items-center justify-between h-14">

          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#37003c] flex items-center justify-center">
              <span className="text-[#00ff85] text-xs font-black">FPL</span>
            </div>
            <span className="font-bold text-gray-900 text-sm tracking-tight">Analysis</span>
          </div>

          {/* Nav tabs */}
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `text-sm px-4 py-2 rounded-lg font-medium transition-all ${
                    isActive
                      ? 'bg-[#37003c] text-[#00ff85]'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right slot */}
          <div className="w-24" /> {/* spacer to balance brand */}
        </div>
      </header>

      {/* Page content */}
      <main className="px-6 py-6">
        <Routes>
          <Route path="/"               element={<Dashboard />}    />
          <Route path="/fixtures"       element={<Fixtures />}     />
          <Route path="/players"        element={<Players />}      />
          <Route path="/players/:id"    element={<PlayerDetail />} />
        </Routes>
      </main>
    </div>
  );
}
