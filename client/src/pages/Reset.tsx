import { useState } from 'react';
import { api } from '../api';
import { Moustache } from '../components/Logo';

// Nieuw wachtwoord instellen via de reset-link uit de e-mail (/reset?token=…).
export default function Reset() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(token ? '' : 'Deze link is onvolledig — open de link uit de e-mail opnieuw.');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== repeat) { setError('De wachtwoorden komen niet overeen'); return; }
    setBusy(true);
    try {
      await api('/api/auth/reset', { method: 'POST', json: { token, password } });
      setDone(true);
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
        <h2 style={{ fontSize: 19 }}>Nieuw wachtwoord</h2>
        {done ? (
          <>
            <p className="muted">Je wachtwoord is aangepast. Je kunt nu inloggen met je nieuwe wachtwoord.</p>
            <div style={{ marginTop: 18 }}>
              <a className="btn btn-primary btn-block" href="/login">Naar inloggen</a>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>Nieuw wachtwoord</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoFocus />
            <label>Herhaal wachtwoord</label>
            <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={6} />
            {error && <div className="error">{error}</div>}
            <div style={{ marginTop: 18 }}>
              <button className="btn btn-primary btn-block" disabled={busy || !token}>Wachtwoord instellen</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
