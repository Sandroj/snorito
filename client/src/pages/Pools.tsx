import { useEffect, useState } from 'react';
import { api } from '../api';

interface Pool {
  id: number;
  name: string;
  memberCount: number;
  isOwner: boolean;
  code?: string;
}

export default function Pools() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const load = () => api('/api/pools').then((p) => setPools(p.pools));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await api('/api/pools', { method: 'POST', json: { name: newName } });
      setMsg({ kind: 'success', text: `Poule aangemaakt. Deel code ${res.code} met je vrienden.` });
      setNewName('');
      load();
    } catch (err: any) {
      setMsg({ kind: 'error', text: err.message });
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await api('/api/pools/join', { method: 'POST', json: { code: joinCode } });
      setMsg({ kind: 'success', text: `Je doet nu mee met "${res.name}".` });
      setJoinCode('');
      load();
    } catch (err: any) {
      setMsg({ kind: 'error', text: err.message });
    }
  };

  const copy = async (pool: Pool) => {
    if (!pool.code) return;
    try {
      await navigator.clipboard.writeText(pool.code);
      setCopied(pool.id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard niet beschikbaar */ }
  };

  const leave = async (pool: Pool) => {
    if (!confirm(`Weet je zeker dat je "${pool.name}" wilt verlaten?`)) return;
    await api(`/api/pools/${pool.id}/leave`, { method: 'POST' });
    load();
  };

  return (
    <div className="fade-in">
      <h1>Poules</h1>
      <p className="page-sub">Speel met je eigen team mee in zoveel poules als je wilt.</p>
      {msg && <div className={msg.kind}>{msg.text}</div>}

      {pools.map((p) => (
        <div key={p.id} className="card row spread">
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>{p.name}</b>
            <div className="muted" style={{ marginTop: 2 }}>
              {p.memberCount} deelnemer{p.memberCount !== 1 ? 's' : ''}
              {p.isOwner && ' · jij bent organisator'}
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {p.isOwner && p.code && (
              <button className="btn btn-ghost btn-sm" onClick={() => copy(p)}>
                {copied === p.id ? 'Gekopieerd ✓' : `Code: ${p.code}`}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => leave(p)}>Verlaten</button>
          </div>
        </div>
      ))}
      {pools.length === 0 && (
        <div className="card empty">
          <div className="emoji">👥</div>
          Je zit nog niet in een poule.<br />Maak er een aan of doe mee met een code.
        </div>
      )}

      <div className="section-label">Nieuwe poule</div>
      <div className="card">
        <form onSubmit={create} className="row" style={{ flexWrap: 'nowrap' }}>
          <input placeholder="Naam van je poule" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <button className="btn btn-primary" style={{ flexShrink: 0 }}>Aanmaken</button>
        </form>
        <p className="muted" style={{ margin: '8px 0 0' }}>Gratis en onbeperkt. Je krijgt een unieke code om te delen.</p>
      </div>

      <div className="section-label">Meedoen</div>
      <div className="card">
        <form onSubmit={join} className="row" style={{ flexWrap: 'nowrap' }}>
          <input placeholder="Uitnodigingscode (bijv. DEMO01)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required />
          <button className="btn btn-dark" style={{ flexShrink: 0 }}>Meedoen</button>
        </form>
      </div>
    </div>
  );
}
