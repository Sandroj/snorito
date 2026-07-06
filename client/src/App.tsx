import { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, User } from './api';
import { Logo } from './components/Logo';
import { ShirtIcon, LineupIcon, TrophyIcon, UsersIcon, StarIcon, BookIcon, GearIcon, LogoutIcon } from './components/Icons';
import Login from './pages/Login';
import Team from './pages/Team';
import Lineup from './pages/Lineup';
import Ranking from './pages/Ranking';
import Pools from './pages/Pools';
import Points from './pages/Points';
import Rules from './pages/Rules';
import Admin from './pages/Admin';
import Reset from './pages/Reset';

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
          <Route path="/reset" element={<Reset />} />
          <Route path="*" element={<Login />} />
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
          <Route path="/team" element={<Team />} />
          <Route path="/opstelling" element={<Lineup />} />
          <Route path="/klassement" element={<Ranking />} />
          <Route path="/poules" element={<Pools />} />
          <Route path="/punten" element={<Points />} />
          <Route path="/regels" element={<Rules />} />
          <Route path="/reset" element={<Reset />} />
          {user.isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/team" />} />
        </Routes>
      </main>
      <nav className="tabs">
        <NavLink to="/team"><ShirtIcon />Team</NavLink>
        <NavLink to="/opstelling"><LineupIcon />Opstelling</NavLink>
        <NavLink to="/klassement"><TrophyIcon />Klassement</NavLink>
        <NavLink to="/poules"><UsersIcon />Poules</NavLink>
        <NavLink to="/punten"><StarIcon />Punten</NavLink>
      </nav>
    </SessionContext.Provider>
  );
}
