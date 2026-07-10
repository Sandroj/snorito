import { useEffect, useState, createContext, useContext, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, User } from './api';
import { Logo } from './components/Logo';
import { ShirtIcon, LineupIcon, TrophyIcon, UsersIcon, StarIcon, BookIcon, GearIcon, LogoutIcon } from './components/Icons';

// Lazy-loaded page components for code-splitting
const Login = lazy(() => import('./pages/Login'));
const Team = lazy(() => import('./pages/Team'));
const Lineup = lazy(() => import('./pages/Lineup'));
const Ranking = lazy(() => import('./pages/Ranking'));
const Pools = lazy(() => import('./pages/Pools'));
const Points = lazy(() => import('./pages/Points'));
const Rules = lazy(() => import('./pages/Rules'));
const Admin = lazy(() => import('./pages/Admin'));
const Reset = lazy(() => import('./pages/Reset'));

interface Session {
  user: User | null;
  teamCount: number;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session>({ user: null, teamCount: 0, refresh: async () => {} });
export const useSession = () => useContext(SessionContext);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [teamCount, setTeamCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = async () => {
    const data = await api('/api/me');
    setUser(data.user);
    setTeamCount(data.teamCount || 0);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    navigate('/login');
  };

  if (loading) return <div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>;

  if (!user) {
    return (
      <SessionContext.Provider value={{ user, teamCount, refresh }}>
        <Routes>
          <Route path="/reset" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Reset /></Suspense>} />
          <Route path="*" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Login /></Suspense>} />
        </Routes>
      </SessionContext.Provider>
    );
  }

  return (
    <SessionContext.Provider value={{ user, teamCount, refresh }}>
      <div className="bg-anim" aria-hidden>
        <span className="blob1" />
        <span className="blob2" />
        <span className="blob3" />
      </div>
      <header className="topbar">
        <NavLink to="/opstelling" style={{ textDecoration: 'none' }} aria-label="Naar opstelling">
          <Logo />
        </NavLink>
        <div className="top-actions">
          <NavLink to="/regels" className={({ isActive }) => `iconbtn${isActive ? ' active' : ''}`} title="Spelregels" aria-label="Spelregels">
            <BookIcon />
          </NavLink>
          {user.isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `iconbtn${isActive ? ' active' : ''}`} title="Beheer" aria-label="Beheer">
              <GearIcon />
            </NavLink>
          )}
          <button className="iconbtn" onClick={logout} title="Uitloggen" aria-label="Uitloggen">
            <LogoutIcon />
          </button>
        </div>
      </header>
      <main className="app">
        <Routes>
          <Route path="/" element={<Navigate to="/team" />} />
          <Route path="/login" element={<Navigate to="/team" />} />
          <Route path="/team" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Team /></Suspense>} />
          <Route path="/opstelling" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Lineup /></Suspense>} />
          <Route path="/klassement" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Ranking /></Suspense>} />
          <Route path="/poules" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Pools /></Suspense>} />
          <Route path="/uitslagen" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Points /></Suspense>} />
          <Route path="/punten" element={<Navigate to="/uitslagen" />} />
          <Route path="/regels" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Rules /></Suspense>} />
          <Route path="/reset" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Reset /></Suspense>} />
          {user.isAdmin && <Route path="/admin" element={<Suspense fallback={<div className="center" style={{ marginTop: 90, color: '#667085' }}>Laden…</div>}><Admin /></Suspense>} />}
          <Route path="*" element={<Navigate to="/team" />} />
        </Routes>
      </main>
      <nav className="tabs">
        <NavLink to="/team"><ShirtIcon />Team</NavLink>
        <NavLink to="/opstelling"><LineupIcon />Opstelling</NavLink>
        <NavLink to="/uitslagen"><StarIcon />Uitslagen</NavLink>
        <NavLink to="/klassement"><TrophyIcon />Klassement</NavLink>
        <NavLink to="/poules"><UsersIcon />Poules</NavLink>
      </nav>
    </SessionContext.Provider>
  );
}
