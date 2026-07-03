import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { Moustache } from '../components/Logo';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await api('/api/auth/login', { method: 'POST', json: { email, password } });
      } else {
        await api('/api/auth/register', { method: 'POST', json: { name, email, password } });
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-hero">
      <div className="auth-logo fade-in">
        <Moustache size={72} />
        <span className="logo-word">SN<span className="logo-o">O</span>RITO</span>
        <span className="auth-tagline">Wielerpoule · Tour de France 2026</span>
      </div>
      <div className="auth-card fade-in">
        <h2 style={{ fontSize: 19 }}>{mode === 'login' ? 'Welkom terug' : 'Doe mee met de poule'}</h2>
        <p className="muted" style={{ marginTop: -4 }}>
          {mode === 'login' ? 'Log in en beheer je team.' : 'Maak een account en stel je team van 20 renners samen.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <>
              <label>Naam</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </>
          )}
          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Wachtwoord</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="error">{error}</div>}
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {mode === 'login' ? 'Inloggen' : 'Account aanmaken'}
            </button>
          </div>
        </form>
        <p className="auth-switch">
          {mode === 'login' ? (
            <>Nog geen account? <a onClick={() => setMode('register')} style={{ cursor: 'pointer', fontWeight: 700 }}>Registreren</a></>
          ) : (
            <>Al een account? <a onClick={() => setMode('login')} style={{ cursor: 'pointer', fontWeight: 700 }}>Inloggen</a></>
          )}
        </p>
      </div>
      <p className="auth-demo">
        Demo-accounts<br />
        max@demo.nl / demo123 · admin@snorito.app / admin123
      </p>
    </div>
  );
}
