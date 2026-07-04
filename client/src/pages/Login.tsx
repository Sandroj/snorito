import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { Moustache } from '../components/Logo';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [forgotSent, setForgotSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).get('error') === 'google'
      ? 'Inloggen met Google is niet gelukt — probeer het opnieuw of gebruik e-mail.'
      : ''
  );
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await api('/api/auth/forgot', { method: 'POST', json: { email } });
        setForgotSent(true);
        return;
      }
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
        <h2 style={{ fontSize: 19 }}>
          {mode === 'login' ? 'Welkom terug' : mode === 'register' ? 'Doe mee met de poule' : 'Wachtwoord vergeten'}
        </h2>
        <p className="muted" style={{ marginTop: -4 }}>
          {mode === 'login' ? 'Log in en beheer je team.'
            : mode === 'register' ? 'Maak een account en stel je team van 20 renners samen.'
            : 'Vul je e-mailadres in; je ontvangt een link om een nieuw wachtwoord in te stellen.'}
        </p>
        {mode === 'forgot' && forgotSent ? (
          <>
            <p>Als dit adres bij ons bekend is, is er een e-mail verstuurd met een reset-link (1 uur geldig). Check ook je spam-map.</p>
            <p className="auth-switch">
              <a onClick={() => { setMode('login'); setForgotSent(false); }} style={{ cursor: 'pointer', fontWeight: 700 }}>Terug naar inloggen</a>
            </p>
          </>
        ) : (
        <form onSubmit={submit}>
          {mode === 'register' && (
            <>
              <label>Naam</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </>
          )}
          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== 'forgot' && (
            <>
              <label>Wachtwoord</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          )}
          {mode === 'login' && (
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              <a onClick={() => { setMode('forgot'); setError(''); }} style={{ cursor: 'pointer' }}>Wachtwoord vergeten?</a>
            </p>
          )}
          {error && <div className="error">{error}</div>}
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {mode === 'login' ? 'Inloggen' : mode === 'register' ? 'Account aanmaken' : 'Verstuur reset-link'}
            </button>
          </div>
          {mode === 'forgot' && (
            <p className="auth-switch">
              <a onClick={() => setMode('login')} style={{ cursor: 'pointer', fontWeight: 700 }}>Terug naar inloggen</a>
            </p>
          )}
        </form>
        )}
        <div className="auth-divider"><span>of</span></div>
        <a className="btn btn-google btn-block" href="/api/auth/google">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.5 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.8c4.4-4.1 7.2-10.1 7.2-17.5z" />
            <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
            <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.4-5.8c-2 1.4-4.6 2.2-7.6 2.2-6.3 0-11.7-4-13.6-9.7l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
          </svg>
          Doorgaan met Google
        </a>
        <p className="auth-switch">
          {mode === 'login' ? (
            <>Nog geen account? <a onClick={() => setMode('register')} style={{ cursor: 'pointer', fontWeight: 700 }}>Registreren</a></>
          ) : (
            <>Al een account? <a onClick={() => setMode('login')} style={{ cursor: 'pointer', fontWeight: 700 }}>Inloggen</a></>
          )}
        </p>
      </div>
    </div>
  );
}
